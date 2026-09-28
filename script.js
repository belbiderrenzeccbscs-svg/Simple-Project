console.log("✅ script.js loaded");

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.xom",
  projectId: "YOUR_PROJECY",
  storageBucket: "YOUR_PROJECY.firebasestorage.app",
  messagingSenderId: "84564374740",
  appId: "YOUR_ID",
  measurementId: "YOUR_APP_ID"
};

// ===============================================
// 1. FIREBASE INITIALIZATION
// ===============================================
const app = firebase.initializeApp(firebaseConfig);
const auth = app.auth();
const db = app.firestore();
const storage = app.storage();

// ===============================================
// 2. GLOBAL STATE AND DOM ELEMENTS
// ===============================================
let currentUser = null;
let currentView = "feed";
let currentPosts = [];

const authPage = document.getElementById("auth-page");
const mainPage = document.getElementById("main-page");
const currentUserDisplay = document.getElementById("current-user");
const feed = document.getElementById("feed");
const clearAllBtn = document.getElementById("clearAllBtn");

console.log("✅ script.js loaded and Firebase initialized");

let isSignup = false;

// ===============================================
// 3. AUTHENTICATION & SESSION MANAGEMENT
// ===============================================
function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            const user = result.user;

            // 1. Check if the user is signing up for the very first time.
            // Google auth typically provides a displayName, so we check if it's missing 
            // or if the user record in Firestore doesn't exist yet (handled in the listener).
            // A more robust way is to check the `isNewUser` property on the credential,
            // but for simplicity, we'll let the listener handle the username check.
            console.log("Google Sign-In successful:", user.displayName);

        })
        .catch((error) => {
            // Handle errors for pop-up being closed, etc.
            if (error.code !== 'auth/popup-closed-by-user') {
                alert("Error signing in: " + error.message);
            }
        });
}

function logout() {
    auth.signOut().then(() => {
        // auth.onAuthStateChanged listener handles the page switch
    }).catch((error) => {
        console.error("Logout error:", error);
    });
}

function promptForUsername(defaultUsername) {
    const input = prompt(
        `Please enter a unique username (or click 'Cancel' to use the default: ${defaultUsername}):`,
        defaultUsername // Pre-fill the input with the default
    );

    // If the user clicks Cancel or enters an empty string, we use the default.
    // The prompt function returns null on Cancel.
    if (input === null || input.trim() === "") {
        console.log("Using default username.");
        return defaultUsername;
    }
    
    // Simple validation (you can add more checks later)
    if (input.trim().length < 3 || input.trim().length > 20) {
        alert("Username must be between 3 and 20 characters.");
        return promptForUsername(defaultUsername); // Recursively prompt again
    }

    return input.trim();
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        // --- AUTHENTICATED ---

        let finalUsername = user.displayName;

        // 1. Check if this is the first time we've seen this user's profile data
        // Google does not always provide a displayName, OR the user hasn't set it yet.
        if (!user.displayName) {
            
            // a. Generate the default username from email (part before @)
            const defaultName = user.email.split('@')[0];

            // b. Prompt the user for a username
            const requestedUsername = promptForUsername(defaultName);
            
            // c. Update the user's profile in Firebase Auth
            await user.updateProfile({
                displayName: requestedUsername
            }).then(() => {
                console.log("Firebase Auth profile updated with new username:", requestedUsername);
                finalUsername = requestedUsername; // Use the newly set name
            }).catch(error => {
                console.error("Error updating profile:", error);
                // Fallback to default if profile update fails
                finalUsername = defaultName;
            });
        }
        
        // 2. Set the global currentUser state with the guaranteed username
        currentUser = { 
            uid: user.uid, 
            // Ensure a fallback to the email prefix if finalUsername is null/undefined
            username: finalUsername || user.email.split('@')[0],
            email: user.email
        };
        
        showMainPage();
        
        // 3. Save/Update user record in Firestore (using the finalUsername)
        db.collection("users").doc(currentUser.uid).set({
            username: currentUser.username, // Use the new/confirmed name
            email: currentUser.email,
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

    } else {
        // --- SIGNED OUT ---
        currentUser = null;
        mainPage.classList.add("hidden");
        authPage.classList.remove("hidden");
    }
});

function showMainPage() {
    authPage.classList.add("hidden");
    mainPage.classList.remove("hidden");
    // Use the currentUser object property, not local storage
    currentUserDisplay.textContent = currentUser.username;
    showFeed(); 
}

// ===============================================
// 4. POST CREATION (Storage & Firestore Write)
// ===============================================
function logout() {
  localStorage.removeItem("currentUser");
  currentUser = null;
  mainPage.classList.add("hidden");
  authPage.classList.remove("hidden");
}

function uploadFile() {
    // Use the immediate Firebase check for the currently signed-in user
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return alert("You must be logged in to upload a file.");

    const fileInput = document.getElementById("fileInput");
    const captionInput = document.getElementById("captionInput");
    const file = fileInput.files[0];
    const caption = captionInput.value.trim();

    if (!file) return alert("No file selected.");
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        return alert("Only image or video files are supported.");
    }
    
    // 1. Upload file to Firebase Storage
    // Use firebaseUser.uid directly for the path
    const fileRef = storage.ref(`files/${firebaseUser.uid}/${Date.now()}_${file.name}`);
    const uploadTask = fileRef.put(file);

    // Optional: Add progress reporting back for better UX
    const uploadButton = document.querySelector('.upload-section button:first-of-type');
    
    uploadTask.on('state_changed', 
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log('Upload is ' + progress.toFixed(0) + '% done');
            uploadButton.textContent = `Uploading... ${progress.toFixed(0)}%`;
        }, 
        (error) => {
            console.error("Upload failed:", error);
            alert("File upload failed: " + error.message);
            uploadButton.textContent = 'Upload';
        }, 
        () => {
            // 2. Get the file URL and save post data to Firestore
            fileRef.getDownloadURL().then((url) => {
                const newPost = {
                    // Use the properties from the global currentUser object set by the listener
                    uploaderId: currentUser.uid, 
                    uploaderName: currentUser.username,
                    filename: file.name,
                    fileType: file.type,
                    fileURL: url,
                    caption: caption || "",
                    likes: 0,
                    likedBy: [],
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                // 3. Save to Firestore
                db.collection("posts").add(newPost)
                    .then(() => {
                        alert("File uploaded successfully!");
                        fileInput.value = "";
                        captionInput.value = "";
                        uploadButton.textContent = 'Upload'; // Reset button
                        // Listener handles re-rendering
                    })
                    .catch((e) => {
                        console.error("Firestore write error:", e);
                        alert("Failed to save post data.");
                        uploadButton.textContent = 'Upload';
                    });
            });
        }
    );
}


// ===============================================
// 5. VIEW SWITCHING & FEED RENDERING
// ===============================================
function showFeed() {
    currentView = "feed";
    document.getElementById("feedBtn").classList.add("active");
    document.getElementById("trendsBtn").classList.remove("active");
    document.getElementById("profileBtn").classList.remove("active");
    clearAllBtn.classList.add("hidden"); 

    // Real-time listener for ALL posts
    db.collection("posts").orderBy("timestamp", "desc").onSnapshot(snapshot => {
        currentPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFeed(currentPosts);
    }, error => {
        console.error("Error fetching feed:", error);
        feed.innerHTML = "<p>Error loading posts.</p>";
    });
}

function showTrends() {
    currentView = "trends";
    document.getElementById("feedBtn").classList.remove("active");
    document.getElementById("profileBtn").classList.remove("active");
    document.getElementById("trendsBtn").classList.add("active");
    clearAllBtn.classList.add("hidden");

    // Sort the local currentPosts array based on likes
    const sortedPosts = [...currentPosts].sort((a, b) => b.likes - a.likes);
    renderFeed(sortedPosts);
}

function showProfile() {
    if (!currentUser) return;

    currentView = "profile";
    document.getElementById("feedBtn").classList.remove("active");
    document.getElementById("trendsBtn").classList.remove("active");
    document.getElementById("profileBtn").classList.add("active");
    clearAllBtn.classList.remove("hidden");

    // Filter posts by uploaderName (not the old 'uploader' property)
    const userPosts = currentPosts.filter(p => p.uploaderName === currentUser.username);
    const totalLikes = userPosts.reduce((sum, p) => sum + p.likes, 0);
    
    // Render Profile Card
    feed.innerHTML = `
        <div class="profile-card">
            <img src="https://cdn-icons-png.flaticon.com/512/847/847969.png" alt="Profile Picture" class="profile-pic">
            <h2>${currentUser.username}</h2>
            <p>📸 Posts: ${userPosts.length}</p>
            <p>❤️ Total Likes: ${totalLikes}</p>
        </div>
        <div class="profile-header">
            <h3>${currentUser.username}'s Posts</h3>
        </div>
    `;
    
    // Render the user's posts
    renderFeed(userPosts, true); 
}

function renderFeed(list, append = false) {
    if (!append) feed.innerHTML = ""; 

    list.forEach(post => {
        const div = document.createElement("div");
        div.className = "post";

        const isImage = post.fileType && post.fileType.startsWith("image/");
        const isVideo = post.fileType && post.fileType.startsWith("video/");
        
        let filePreview;
        if (isImage) {
            filePreview = `<img src="${post.fileURL}" alt="${post.filename}" class="preview-img">`;
        } else if (isVideo) {
            filePreview = `<video controls src="${post.fileURL}" class="preview-img"></video>`;
        } else {
             filePreview = `<div class="file-name">📎 ${post.filename}</div>`;
        }

        const captionHtml = post.caption
          ? `<div class="caption">"${post.caption}"</div>`
          : "";
        
        // Ensure post.likedBy exists before checking includes()
        const isLiked = post.likedBy && currentUser && post.likedBy.includes(currentUser.uid);
        const likeIcon = isLiked ? '❤️' : '🤍';
        const likeColor = isLiked ? 'red' : '#666'; 

        div.innerHTML = `
          <div class="post-header">
            <img src="https://cdn-icons-png.flaticon.com/512/847/847969.png">
            <div>
              <strong>${post.uploaderName}</strong><br>
              <small>${post.timestamp ? post.timestamp.toDate().toLocaleString() : 'Just Now'}</small>
            </div>
            <div class="menu" onclick="toggleMenu('${post.id}')">⋮</div> 
            <div id="menu${post.id}" class="dropdown">
              ${(currentUser && post.uploaderId === currentUser.uid) ? `<a href="#" onclick="deletePost('${post.id}')"> Delete</a>` : ""}
              <a href="${post.fileURL}" download="${post.filename}"> Download</a>
            </div>
          </div>
          ${captionHtml}
          ${filePreview}
          <div class="footer">
            <span class="heart" onclick="toggleLike('${post.id}')" style="color: ${likeColor};">
              ${likeIcon}
            </span>
            <span>${post.likes} likes</span>
          </div>
        `;
        feed.appendChild(div);
    });
}

function toggleMenu(id) {
    const menu = document.getElementById("menu" + id);
    // Hide all other menus first
    document.querySelectorAll('.dropdown').forEach(d => {
        if (d.id !== menu.id) d.style.display = "none";
    });
    // Toggle the clicked menu
    menu.style.display = menu.style.display === "block" ? "none" : "block";
}

// ===============================================
// 6. POST ACTIONS (Firestore Write)
// ===============================================
function deletePost(postId) {
    if (!currentUser || !confirm("Are you sure you want to delete this post?")) return;

    const postRef = db.collection("posts").doc(postId);
    const postToDelete = currentPosts.find(p => p.id === postId);

    if (postToDelete && postToDelete.uploaderId === currentUser.uid) {
        // 1. Delete file from Storage (CRITICAL FIX)
        const fileToDeleteRef = storage.refFromURL(postToDelete.fileURL);
        fileToDeleteRef.delete().then(() => {
            console.log("File successfully deleted from Storage.");
        }).catch((error) => {
            console.warn("Could not delete file from Storage:", error);
        });

        // 2. Delete the Firestore document
        postRef.delete()
            .catch((error) => {
                console.error("Error deleting post:", error);
                alert("Failed to delete post document.");
            });
    } else {
        alert("Permission denied. You can only delete your own posts.");
    }
}

function toggleLike(postId) {
    if (!currentUser) return alert("Please sign in to like posts.");

    const postRef = db.collection("posts").doc(postId);
    const userId = currentUser.uid;
    const post = currentPosts.find(p => p.id === postId);

    if (!post) return;

    const currentlyLiked = post.likedBy && post.likedBy.includes(userId);

    if (currentlyLiked) {
        // Unliking: Use increment(-1) for safe concurrent updates
        postRef.update({
            likes: firebase.firestore.FieldValue.increment(-1),
            likedBy: firebase.firestore.FieldValue.arrayRemove(userId)
        }).catch(e => console.error("Error unliking:", e));

    } else {
        // Liking: Use increment(1) for safe concurrent updates
        postRef.update({
            likes: firebase.firestore.FieldValue.increment(1),
            likedBy: firebase.firestore.FieldValue.arrayUnion(userId)
        }).catch(e => console.error("Error liking:", e));
    }
}

function clearAllPosts() {
    if (!currentUser || !confirm("Are you sure you want to delete all your posts? This cannot be undone.")) return;

    const userId = currentUser.uid;
    const batch = db.batch();
    let deleteCount = 0;
    
    db.collection("posts").where("uploaderId", "==", userId).get()
        .then((snapshot) => {
            if (snapshot.empty) {
                alert("You have no posts to delete.");
                return Promise.resolve();
            }

            snapshot.docs.forEach((doc) => {
                const post = doc.data();
                // CRITICAL FIX: Delete file from Storage before deleting the Firestore reference
                storage.refFromURL(post.fileURL).delete().catch(e => console.warn("Failed to delete storage file in batch:", e));
                
                batch.delete(doc.ref);
                deleteCount++;
            });

            return batch.commit();
        })
        .then(() => {
            if (deleteCount > 0) {
                alert(`Successfully deleted ${deleteCount} post(s).`);
            }
            showProfile(); 
        })
        .catch((error) => {
            console.error("Error performing batch delete:", error);
            alert("Failed to clear all posts. Please check the console for errors.");
        });
}

window.signInWithGoogle = signInWithGoogle;
window.promptForUsername = promptForUsername;
window.logout = logout;
window.showFeed = showFeed;
window.showTrends = showTrends;
window.showProfile = showProfile;
window.uploadFile = uploadFile;
window.clearAllPosts = clearAllPosts;
window.deletePost = deletePost;
window.toggleLike = toggleLike;
window.toggleMenu = toggleMenu;
