# Bondify - Professional Social Networking Platform

> **Where Bonds Begin** — A full-featured social media platform built with modern web standards, focusing on meaningful connections and community engagement.

## 🎯 Features

### Core Functionality
- **User Authentication** - Secure registration & login with session management
- **User Profiles** - Customizable profiles with display name, bio, profile photo, and cover photo
- **Social Networking**
  - Follow/unfollow users
  - View followers & following lists
  - Smart user suggestions with advanced ranking algorithm
  - Search users by display name or username
- **Posts & Engagement**
  - Create posts with up to 5 attachments (images/files)
  - Drag-and-drop attachment upload
  - Comment on posts with real-time updates
  - Like posts and comments
  - Mention other users (@username or @displayName)
  - Attachment preview with fallback rendering
- **Notifications**
  - Real-time notifications for followed users' posts
  - Mention notifications in comments
  - Notification panel with unread badge
  - Click notification to jump to target post/comment
  - Mark notifications as read
- **UI/UX**
  - Professional green-white design system
  - Dark mode support with theme toggle
  - Smooth animations and transitions
  - Responsive design for mobile & desktop
  - Loading skeletons for better perceived performance
  - Toast notifications for user actions

### Technical Highlights
- **Dual API Modes**
  - Mock mode: Full functionality using browser localStorage (no backend required)
  - Real mode: PHP/MySQL backend with production architecture
- **Smart Mention System** - Autocomplete with user search during comments
- **Image Compression** - Client-side optimization for faster uploads
- **Deep Linking** - Navigate directly to posts/comments from notifications
- **Advanced Suggestions** - Ranking by mutual connections, activity, and interaction recency

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Edge, Safari)
- **For real mode only:** PHP 7.4+ and MySQL 5.7+

### Installation (Mock Mode - No Backend)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Jukta06/Bondify.git
   cd Bondify
   ```

2. **Open in browser:**
   - Simply double-click `index.html` or
   - Use a local server:
     ```bash
     # Python 3
     python -m http.server 8000
     
     # Node.js (http-server)
     npx http-server
     
     # PHP
     php -S localhost:8000
     ```

3. **Access the app:**
   - Navigate to `http://localhost:8000` (or file path if opened directly)
   - Register a new account or login
   - All data is stored in browser localStorage

### Installation (Real Mode - PHP Backend)

1. **Setup database:**
   ```sql
   -- Import schema
   mysql -u root -p < database/socialmedia.sql
   ```

2. **Configure API:**
   - Edit `api/db.php` with your database credentials:
     ```php
     $dbHost = 'localhost';
     $dbName = 'socialmedia';
     $dbUser = 'your_db_user';
     $dbPass = 'your_db_password';
     ```

3. **Set API mode:**
   - Edit `assets/js/config.js`:
     ```javascript
     export const USE_MOCK_SERVER = false; // Set to true for mock mode
     ```

4. **Run on local/production server:**
   ```bash
   # Copy files to web root
   cp -r * /var/www/html/bondify/
   ```

## 📁 Project Structure

```
Bondify/
├─ index.html                 # Landing page with Bondify branding
├─ README.md                  # This file
├─ database/
│  └─ socialmedia.sql        # Database schema (MySQL)
├─ api/
│  ├─ index.php              # Main API backend (PHP)
│  └─ db.php                 # Database connection config
├─ pages/
│  ├─ feed.html              # Social feed (posts & comments)
│  ├─ profile.html           # User profiles & metadata
│  ├─ login.html             # Authentication
│  └─ register.html          # User registration
└─ assets/
   ├─ css/
   │  └─ styles.css          # Global styles + dark mode (1400+ lines)
   └─ js/
      ├─ config.js           # Environment configuration
      ├─ api/
      │  ├─ endpoints.js     # API route definitions
      │  ├─ http.js          # HTTP request handler (fetch wrapper)
      │  └─ mockServer.js    # Mock API implementation (localStorage)
      ├─ services/
      │  ├─ authService.js   # Auth & session management
      │  ├─ userService.js   # User profiles, follow, suggestions
      │  ├─ postService.js   # Posts, comments, likes
      │  └─ notificationService.js # Notifications
      ├─ utils/
      │  ├─ session.js       # Session & storage utilities
      │  └─ ui.js            # Reusable UI rendering helpers
      └─ pages/
         ├─ common.js        # Shared page logic (theme, notifications)
         ├─ feed.js          # Feed interactions
         ├─ profile.js       # Profile management
         ├─ login.js         # Login page logic
         └─ register.js      # Registration page logic
```

## 🔌 API Reference

### Authentication Endpoints
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login user
- `GET /api/auth/logout` - Logout session

### User Endpoints
- `GET /api/users/{id}` - Get user profile
- `PUT /api/users/{id}` - Update profile metadata
- `POST /api/users/{id}/follow` - Follow user
- `DELETE /api/users/{id}/follow` - Unfollow user
- `GET /api/users/{id}/followers` - Get followers list
- `GET /api/users/{id}/following` - Get following list
- `GET /api/users/search/{query}` - Search users by name

### Post Endpoints
- `POST /api/posts` - Create new post with attachments
- `GET /api/posts` - Get user's feed
- `GET /api/posts/{id}/comments` - Get post comments
- `POST /api/comments` - Add comment with mentions
- `POST /api/posts/{id}/like` - Like a post
- `DELETE /api/likes/{id}` - Unlike a post

### Notification Endpoints
- `GET /api/notifications` - Get all notifications
- `PUT /api/notifications/read-all` - Mark all as read
- `PUT /api/notifications/{id}/read` - Mark single as read

## 🎨 Design System

### Colors (Professional Green-White)
- Primary: `#10B981` (Emerald Green)
- Secondary: `#F0FDF4` (White/Light)
- Text: `#1F2937` (Dark Gray)
- Border: `#E5E7EB` (Light Gray)

### Fonts
- Display: **Manrope** (Google Fonts)
- Icons: **Font Awesome 6**

### Dark Mode
- Automatically switches based on system preference
- Manual theme toggle in navbar
- All components have dark variants

## 🔐 Security Notes

### Current Implementation
- Session tokens stored in localStorage
- CSRF protection via token validation (real mode)
- SQL prepared statements (PHP backend)

### For Production
1. **HTTPS Only** - Use SSL/TLS certificates
2. **Secure Headers** - Implement CSP, X-Frame-Options
3. **Password Hashing** - Use bcrypt (already in place on backend)
4. **Rate Limiting** - Add rate limit middleware
5. **Input Validation** - Sanitize all user inputs
6. **Environment Variables** - Never commit DB credentials (use `.env`)

## 💾 Database Schema

### Users Table
```sql
users (id, username, password_hash, email, display_name, bio, profile_photo_url, cover_photo_url, created_at, updated_at)
```

### Posts Table
```sql
posts (id, user_id, content, created_at, updated_at)
```

### Attachments Table
```sql
attachments (id, post_id, file_url, file_type, created_at)
```

### Comments Table
```sql
comments (id, post_id, user_id, content, created_at, updated_at)
```

### Likes Table
```sql
likes (id, post_id/comment_id, user_id, created_at)
```

### Follows Table
```sql
follows (id, follower_id, following_id, created_at)
```

### Notifications Table
```sql
notifications (id, user_id, type, message, related_user_id, post_id, comment_id, is_read, created_at, read_at)
```

## 🧪 Testing

### Test Accounts (Mock Mode)
After running the app, create test accounts:
- Account 1: username=`alice`, password=`pass123`
- Account 2: username=`bob`, password=`pass456`
- Follow each other, create posts, view notifications

### Common Workflows
1. **Follow Suggestion** - Register 3+ users, suggestions appear on profile
2. **Mention Notification** - Comment with `@username`, notification triggered
3. **Deep Link** - Click notification → scrolls to post with pulse animation
4. **Dark Mode** - Toggle in navbar, refreshes appearance

## 🐛 Known Issues

- localStorage has ~5-10MB size limit (base64 images compressed to mitigate)
- Mention search is case-insensitive (by design for UX)
- Notifications require page refresh or bell click to update (polling every 15s)

## 🚀 Deployment Checklist

- [ ] Update `assets/js/config.js` - Set `USE_MOCK_SERVER = false` for production
- [ ] Configure `api/db.php` - Add production database credentials
- [ ] Update `index.html` - Verify domain/protocol for any external resources
- [ ] Enable HTTPS - Get SSL certificate, redirect HTTP → HTTPS
- [ ] Set `.gitignore` - Exclude `api/db.php`, `.env`, node_modules, etc.
- [ ] Test all features - Auth, posts, comments, follows, notifications
- [ ] Run on production server - Apache/Nginx with PHP support

## 📱 Browser Support

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 90+ | ✅ Tested |
| Firefox | 88+ | ✅ Tested |
| Safari | 14+ | ✅ Tested |
| Edge | 90+ | ✅ Tested |

## 📝 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Found a bug or have a feature request? Please open an issue on GitHub!

---

**Built with ❤️ by the Bondify Team**  
*Last Updated: 2024*
```

## Run (XAMPP + MySQL)

1. Start **Apache** and **MySQL** from XAMPP.
2. Import `database/socialmedia.sql` into phpMyAdmin (or run it in MySQL CLI).
3. Ensure this project is in: `C:/xampp/htdocs/social media app`.
4. Open in browser: `http://localhost/social%20media%20app/`

The app is configured to use the real PHP/MySQL API at `/social media app/api/*`.

## API Style

Frontend services are mapped to REST endpoints in `assets/js/api/endpoints.js` and accessed through `assets/js/api/http.js`.

Default mode in this project is now the real API (`USE_MOCK_API: false`).

If you want to switch back to local mock mode, edit `assets/js/config.js`:

- `USE_MOCK_API: true`
- `API_BASE_URL: ""`

## Backend Files Added

- `api/index.php` (REST API router + handlers)
- `api/db.php` (PDO connection to `socialmedia`)
- `api/.htaccess` (route rewriting to `index.php`)
- `database/socialmedia.sql` (schema)
