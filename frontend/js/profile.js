/* ============================================================
 *  FRESHMART — Profile.js
 *  Handles profile picture display, upload, and profile
 *  navigation in the mobile menu / nav bar.
 *  Compatible with the enhanced main.js auth system.
 * ============================================================ */

(function setupProfile() {
    var user = getCurrentUser();
    if (!user) return;

    // Inject profile elements into the nav
    var nav = document.querySelector(".navbar .nav-actions");
    if (nav && !document.getElementById("profileContainer")) {
        var profileHTML =
            '<a href="#" class="nav-action profile-trigger" id="profileTrigger">' +
            '  <span class="action-icon">' +
            (user.profilePic && user.profilePic.image
                ? '<img src="' + user.profilePic.image + '" class="profile-pic-small" alt="Profile">'
                : '<span class="profile-initial-small" style="background:' +
                  (user.profilePic ? user.profilePic.color : "#ff3b20") + '">' +
                  (user.profilePic ? user.profilePic.initials : "U") + "</span>") +
            '</span>' +
            '  <span>' + user.name.split(" ")[0] + "</span>" +
            '</a>' +
            '<div class="profile-dropdown" id="profileDropdown">' +
            '  <a href="#" class="profile-dropdown-item">My Profile</a>' +
            '  <a href="#" class="profile-dropdown-item">My Orders</a>' +
            '  <a href="#" class="profile-dropdown-item">Wishlist</a>' +
            '  <a href="#" onclick="logout()" class="profile-dropdown-item logout">Logout</a>' +
            '</div>' +
            '<form id="profileForm" style="display:none;">' +
            '  <input type="file" id="profileUpload" accept="image/*" onchange="uploadProfilePicture(this)">' +
            '</form>';
        nav.insertAdjacentHTML("beforeend", profileHTML);

        // Toggle profile dropdown
        var trigger = document.getElementById("profileTrigger");
        var dropdown = document.getElementById("profileDropdown");
        trigger.addEventListener("click", function (e) {
            e.preventDefault();
            dropdown.classList.toggle("open");
        });
        document.addEventListener("click", function (e) {
            if (!dropdown.contains(e.target) && e.target !== trigger) {
                dropdown.classList.remove("open");
            }
        });
    }

    // Handle mobile menu login link for logged-in users
    var mobileLoginLink = document.getElementById("mobileLoginLink");
    if (mobileLoginLink) {
        mobileLoginLink.href = "#";
        mobileLoginLink.textContent = "Logout";
        mobileLoginLink.onclick = function (e) { e.preventDefault(); logout(); };
    }
})();
