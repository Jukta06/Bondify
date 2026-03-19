<?php

declare(strict_types=1);

require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function nowIso(string $value): string
{
    return gmdate('c', strtotime($value . ' UTC'));
}

function uid(string $prefix): string
{
    return $prefix . '_' . bin2hex(random_bytes(6));
}

function normalizeMediaInput(?string $value): string
{
    $raw = trim((string)$value);
    if ($raw === '') {
        return '';
    }

    if (preg_match('#^data:image/[^;,]+(?:;[^;,=]+=[^;,]+)*;base64,[A-Za-z0-9+/=\r\n]+$#i', $raw) === 1) {
        return $raw;
    }

    if (!filter_var($raw, FILTER_VALIDATE_URL)) {
        return '';
    }

    $scheme = strtolower((string)parse_url($raw, PHP_URL_SCHEME));
    if ($scheme !== 'http' && $scheme !== 'https') {
        return '';
    }

    return $raw;
}

function ensureUserProfileColumns(PDO $db): void
{
    $columns = [
        'display_name' => "ALTER TABLE users ADD COLUMN display_name VARCHAR(100) NULL AFTER username",
        'profile_photo_url' => "ALTER TABLE users ADD COLUMN profile_photo_url MEDIUMTEXT NULL AFTER bio",
        'cover_photo_url' => "ALTER TABLE users ADD COLUMN cover_photo_url MEDIUMTEXT NULL AFTER profile_photo_url",
    ];

    foreach ($columns as $name => $sql) {
        $existsStmt = $db->prepare("SHOW COLUMNS FROM users LIKE ?");
        $existsStmt->execute([$name]);
        $existing = $existsStmt->fetch();
        if ($existing) {
            if (($name === 'profile_photo_url' || $name === 'cover_photo_url') && stripos((string)$existing['Type'], 'text') === false) {
                $db->exec("ALTER TABLE users MODIFY COLUMN {$name} MEDIUMTEXT NULL");
            }
            continue;
        }
        $db->exec($sql);
    }
}

function ensurePostMediaColumns(PDO $db): void
{
    $columns = [
        'post_media_name' => "ALTER TABLE posts ADD COLUMN post_media_name VARCHAR(255) NULL AFTER content",
        'post_media_type' => "ALTER TABLE posts ADD COLUMN post_media_type VARCHAR(120) NULL AFTER post_media_name",
        'post_media_data' => "ALTER TABLE posts ADD COLUMN post_media_data MEDIUMTEXT NULL AFTER post_media_type",
    ];

    foreach ($columns as $name => $sql) {
        $existsStmt = $db->prepare("SHOW COLUMNS FROM posts LIKE ?");
        $existsStmt->execute([$name]);
        $existing = $existsStmt->fetch();
        if ($existing) {
            if ($name === 'post_media_data' && stripos((string)$existing['Type'], 'text') === false) {
                $db->exec("ALTER TABLE posts MODIFY COLUMN post_media_data MEDIUMTEXT NULL");
            }
            continue;
        }
        $db->exec($sql);
    }
}

function ensurePostAttachmentsTable(PDO $db): void
{
    $db->exec(
        "CREATE TABLE IF NOT EXISTS post_attachments (
            id VARCHAR(32) PRIMARY KEY,
            post_id VARCHAR(32) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_type VARCHAR(120) NOT NULL,
            file_data MEDIUMTEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_post_attachments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB"
    );
}

function ensureNotificationsTable(PDO $db): void
{
    $db->exec(
        "CREATE TABLE IF NOT EXISTS notifications (
            id VARCHAR(32) PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            type VARCHAR(40) NOT NULL,
            message VARCHAR(255) NOT NULL,
            related_user_id VARCHAR(32) NULL,
            post_id VARCHAR(32) NULL,
            comment_id VARCHAR(32) NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            read_at DATETIME NULL,
            CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            CONSTRAINT fk_notifications_related_user FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE SET NULL,
            CONSTRAINT fk_notifications_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            CONSTRAINT fk_notifications_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
            INDEX idx_notifications_user_created (user_id, created_at),
            INDEX idx_notifications_user_read (user_id, is_read)
        ) ENGINE=InnoDB"
    );
}

function extractMentionUsernames(string $text): array
{
    if ($text === '') {
        return [];
    }

    $result = preg_match_all('/(?:^|\\s)@([A-Za-z0-9_]+)/', $text, $matches);
    if ($result === false || $result === 0) {
        return [];
    }

    $names = [];
    foreach (($matches[1] ?? []) as $name) {
        $normalized = trim((string)$name);
        if ($normalized !== '') {
            $names[strtolower($normalized)] = $normalized;
        }
    }

    return array_values($names);
}

function createNotification(PDO $db, array $payload): void
{
    $userId = (string)($payload['userId'] ?? '');
    $type = (string)($payload['type'] ?? '');
    $message = trim((string)($payload['message'] ?? ''));

    if ($userId === '' || $type === '' || $message === '') {
        return;
    }

    $insert = $db->prepare(
        'INSERT INTO notifications (id, user_id, type, message, related_user_id, post_id, comment_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $insert->execute([
        uid('ntf'),
        $userId,
        $type,
        mb_substr($message, 0, 255),
        $payload['relatedUserId'] ?? null,
        $payload['postId'] ?? null,
        $payload['commentId'] ?? null,
    ]);
}

function notifyFollowersOnPost(PDO $db, string $authorId, string $postId): void
{
    $author = userById($db, $authorId);
    if (!$author) {
        return;
    }

    $displayName = (string)($author['displayName'] ?? $author['username'] ?? 'Someone');
    $followersStmt = $db->prepare('SELECT follower_id FROM follows WHERE following_id = ?');
    $followersStmt->execute([$authorId]);
    $rows = $followersStmt->fetchAll();

    foreach ($rows as $row) {
        $followerId = (string)($row['follower_id'] ?? '');
        if ($followerId === '' || $followerId === $authorId) {
            continue;
        }

        createNotification($db, [
            'userId' => $followerId,
            'type' => 'new_post',
            'message' => $displayName . ' posted a new update.',
            'relatedUserId' => $authorId,
            'postId' => $postId,
        ]);
    }
}

function notifyMentionsOnComment(PDO $db, string $actorId, string $postId, string $commentId, string $text): void
{
    $mentions = extractMentionUsernames($text);
    if ($mentions === []) {
        return;
    }

    $actor = userById($db, $actorId);
    $displayName = (string)($actor['displayName'] ?? $actor['username'] ?? 'Someone');

    $lookup = $db->prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(COALESCE(display_name, username)) = LOWER(?) LIMIT 1');
    $delivered = [];

    foreach ($mentions as $username) {
        $lookup->execute([$username, $username]);
        $row = $lookup->fetch();
        $targetId = (string)($row['id'] ?? '');

        if ($targetId === '' || $targetId === $actorId || isset($delivered[$targetId])) {
            continue;
        }

        $delivered[$targetId] = true;

        createNotification($db, [
            'userId' => $targetId,
            'type' => 'mention',
            'message' => $displayName . ' mentioned you in a comment.',
            'relatedUserId' => $actorId,
            'postId' => $postId,
            'commentId' => $commentId,
        ]);
    }
}

function notificationsForUser(PDO $db, string $userId, int $limit = 40): array
{
    $stmt = $db->prepare(
        'SELECT id, type, message, post_id, comment_id, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ' . (int)$limit
    );
    $stmt->execute([$userId]);

    return array_map(
        static fn (array $row): array => [
            'id' => $row['id'],
            'type' => $row['type'],
            'message' => $row['message'],
            'postId' => $row['post_id'] ?? null,
            'commentId' => $row['comment_id'] ?? null,
            'read' => (int)$row['is_read'] === 1,
            'createdAt' => nowIso($row['created_at']),
        ],
        $stmt->fetchAll()
    );
}

function unreadNotificationCount(PDO $db, string $userId): int
{
    $stmt = $db->prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    return (int)($row['total'] ?? 0);
}

function normalizeAttachmentInput($value): ?array
{
    if (!is_array($value)) {
        return null;
    }

    $name = trim((string)($value['name'] ?? ''));
    $type = trim((string)($value['type'] ?? 'application/octet-stream'));
    $data = trim((string)($value['data'] ?? ''));

    if ($name === '' || $data === '') {
        return null;
    }

    if (preg_match('#^data:([^;,]+/[^;,]+)(?:;[^;,=]+=[^;,]+)*;base64,[A-Za-z0-9+/=\r\n]+$#i', $data, $matches) !== 1) {
        return null;
    }

    if ($type === '' || stripos($type, '/') === false) {
        $type = (string)($matches[1] ?? 'application/octet-stream');
    }

    if (strlen($name) > 255) {
        $name = substr($name, 0, 255);
    }

    if (strlen($type) > 120) {
        $type = substr($type, 0, 120);
    }

    return [
        'name' => $name,
        'type' => $type,
        'data' => $data,
    ];
}

function normalizeAttachmentInputs(array $body): array
{
    $normalized = [];
    $items = $body['attachments'] ?? null;

    if (is_array($items)) {
        foreach ($items as $item) {
            $entry = normalizeAttachmentInput($item);
            if ($entry) {
                $normalized[] = $entry;
            }
            if (count($normalized) >= 5) {
                break;
            }
        }
    }

    if ($normalized === []) {
        $single = normalizeAttachmentInput($body['attachment'] ?? null);
        if ($single) {
            $normalized[] = $single;
        }
    }

    return $normalized;
}

function attachmentRowsByPostId(PDO $db, string $postId): array
{
    $stmt = $db->prepare('SELECT file_name, file_type, file_data FROM post_attachments WHERE post_id = ? ORDER BY created_at ASC');
    $stmt->execute([$postId]);

    return array_map(
        static fn (array $row): array => [
            'name' => $row['file_name'],
            'type' => $row['file_type'],
            'data' => $row['file_data'],
        ],
        $stmt->fetchAll()
    );
}

function requestBody(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function tokenUserId(?string $authHeader): ?string
{
    if (!$authHeader || !str_starts_with($authHeader, 'Bearer ')) {
        return null;
    }

    $token = trim(substr($authHeader, 7));
    if (!str_starts_with($token, 'db-token:')) {
        return null;
    }

    $userId = substr($token, strlen('db-token:'));
    return $userId !== '' ? $userId : null;
}

function userById(PDO $db, string $userId): ?array
{
    $stmt = $db->prepare('SELECT id, username, display_name, email, bio, profile_photo_url, cover_photo_url, created_at FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();

    if (!$row) {
        return null;
    }

    return [
        'id' => $row['id'],
        'username' => $row['username'],
        'displayName' => $row['display_name'] ?: $row['username'],
        'email' => $row['email'],
        'bio' => $row['bio'] ?? '',
        'profilePhoto' => $row['profile_photo_url'] ?? '',
        'coverPhoto' => $row['cover_photo_url'] ?? '',
        'followers' => followerIds($db, $row['id']),
        'following' => followingIds($db, $row['id']),
        'createdAt' => nowIso($row['created_at']),
    ];
}

function followerIds(PDO $db, string $userId): array
{
    $stmt = $db->prepare('SELECT follower_id FROM follows WHERE following_id = ?');
    $stmt->execute([$userId]);
    return array_values(array_map(static fn ($row) => $row['follower_id'], $stmt->fetchAll()));
}

function followingIds(PDO $db, string $userId): array
{
    $stmt = $db->prepare('SELECT following_id FROM follows WHERE follower_id = ?');
    $stmt->execute([$userId]);
    return array_values(array_map(static fn ($row) => $row['following_id'], $stmt->fetchAll()));
}

function usersFromIds(PDO $db, array $ids): array
{
    $users = [];
    foreach ($ids as $id) {
        $user = userById($db, (string)$id);
        if ($user) {
            $users[] = $user;
        }
    }
    return $users;
}

function userPostSignals(PDO $db, string $userId): array
{
    $stmt = $db->prepare('SELECT content, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30');
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll();

    $hashtags = [];
    $keywords = [];
    $latestPostTs = 0;

    foreach ($rows as $row) {
        $content = (string)($row['content'] ?? '');
        $ts = strtotime((string)$row['created_at'] . ' UTC');
        if ($ts > $latestPostTs) {
            $latestPostTs = $ts;
        }

        if (preg_match_all('/#([A-Za-z0-9_]+)/', $content, $matches)) {
            foreach ($matches[1] as $tag) {
                $tag = strtolower(trim((string)$tag));
                if ($tag !== '') {
                    $hashtags[$tag] = true;
                }
            }
        }

        $words = preg_split('/[^A-Za-z0-9_]+/', strtolower($content)) ?: [];
        foreach ($words as $word) {
            if (strlen($word) < 4) {
                continue;
            }
            $keywords[$word] = ($keywords[$word] ?? 0) + 1;
        }
    }

    arsort($keywords);
    $topKeywords = array_slice(array_keys($keywords), 0, 18);

    return [
        'hashtags' => array_keys($hashtags),
        'keywords' => $topKeywords,
        'latestPostTs' => $latestPostTs,
    ];
}

function userInterestSignals(PDO $db, array $user): array
{
    $signals = userPostSignals($db, $user['id']);
    $fromBio = preg_split('/[^A-Za-z0-9_]+/', strtolower((string)($user['bio'] ?? ''))) ?: [];
    $bioTerms = [];
    foreach ($fromBio as $term) {
        if (strlen($term) >= 4) {
            $bioTerms[$term] = true;
        }
    }

    $all = array_merge($signals['hashtags'], $signals['keywords'], array_keys($bioTerms));
    return array_values(array_unique($all));
}

function overlapCount(array $a, array $b): int
{
    if ($a === [] || $b === []) {
        return 0;
    }
    return count(array_intersect($a, $b));
}

function recencyScoreFromTimestamp(int $timestamp): float
{
    if ($timestamp <= 0) {
        return 0.0;
    }

    $days = max(0, (time() - $timestamp) / 86400);
    // Exponential decay keeps recent users high and smoothly lowers older activity.
    return 28.0 * exp(-$days / 14.0);
}

function newUserBoostScore(string $createdAtIso): float
{
    $ts = strtotime($createdAtIso);
    if (!$ts) {
        return 0.0;
    }
    $ageDays = max(0, (time() - $ts) / 86400);
    if ($ageDays > 30) {
        return 0.0;
    }
    return 14.0 * (1.0 - ($ageDays / 30.0));
}

function suggestedUsers(PDO $db, string $meId, int $limit = 8): array
{
    $me = userById($db, $meId);
    if (!$me) {
        return [];
    }

    $meFollowing = array_flip($me['following']);
    $meFollowers = $me['followers'];
    $meInterests = userInterestSignals($db, $me);

    $stmt = $db->prepare('SELECT id FROM users WHERE id <> ? ORDER BY created_at DESC');
    $stmt->execute([$meId]);
    $rows = $stmt->fetchAll();

    $candidates = [];
    foreach ($rows as $row) {
        $candidateId = (string)$row['id'];
        if (isset($meFollowing[$candidateId])) {
            continue;
        }

        $candidate = userById($db, $candidateId);
        if (!$candidate) {
            continue;
        }

        $candidateInterests = userInterestSignals($db, $candidate);
        $mutualFollowers = overlapCount($candidate['followers'], $me['following']);
        $mutualFollowing = overlapCount($candidate['following'], $meFollowers);
        $sharedInterests = overlapCount($candidateInterests, $meInterests);

        $signals = userPostSignals($db, $candidateId);
        $recentTs = $signals['latestPostTs'] ?: strtotime($candidate['createdAt']);

        $networkScore = ($mutualFollowers * 7.0) + ($mutualFollowing * 5.0);
        $interestScore = min(28.0, $sharedInterests * 4.5);
        $recentScore = recencyScoreFromTimestamp((int)$recentTs);
        $newUserBoost = newUserBoostScore($candidate['createdAt']);
        $popularitySafety = min(18.0, count($candidate['followers']) * 1.6);
        $coldStartCompensation =
            (count($candidate['followers']) === 0 && count($candidate['following']) === 0)
                ? 6.0
                : 0.0;

        $candidate['score'] =
            $networkScore +
            $interestScore +
            $recentScore +
            $newUserBoost +
            $popularitySafety +
            $coldStartCompensation;

        $candidates[] = $candidate;
    }

    usort(
        $candidates,
        static fn (array $a, array $b): int => $b['score'] <=> $a['score']
    );

    $trimmed = array_slice($candidates, 0, $limit);
    return array_map(
        static function (array $user): array {
            unset($user['score']);
            return $user;
        },
        $trimmed
    );
}

function searchUsers(PDO $db, string $query, string $excludeUserId, int $limit = 12): array
{
    $normalized = trim(mb_strtolower($query));
    if ($normalized === '') {
        return [];
    }

    $like = '%' . $normalized . '%';
    $stmt = $db->prepare(
        'SELECT id FROM users
         WHERE id <> ?
         AND (
           LOWER(username) LIKE ?
           OR LOWER(COALESCE(display_name, username)) LIKE ?
           OR LOWER(email) LIKE ?
         )
         ORDER BY created_at DESC
         LIMIT ' . (int)$limit
    );
    $stmt->execute([$excludeUserId, $like, $like, $like]);

    $users = [];
    foreach ($stmt->fetchAll() as $row) {
        $user = userById($db, (string)$row['id']);
        if ($user) {
            $users[] = $user;
        }
    }

    return $users;
}

function requireAuthUser(PDO $db): array
{
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? null;
    $userId = tokenUserId($authHeader);

    if (!$userId) {
        respond(['message' => 'Unauthorized'], 401);
    }

    $user = userById($db, $userId);
    if (!$user) {
        respond(['message' => 'Unauthorized'], 401);
    }

    return $user;
}

function enrichPost(PDO $db, array $post): array
{
    $author = userById($db, $post['user_id']);

    $likesStmt = $db->prepare('SELECT user_id FROM post_likes WHERE post_id = ?');
    $likesStmt->execute([$post['id']]);
    $likes = array_values(array_map(static fn ($row) => $row['user_id'], $likesStmt->fetchAll()));

    $commentsStmt = $db->prepare('SELECT id, user_id, text, created_at FROM comments WHERE post_id = ? ORDER BY created_at ASC');
    $commentsStmt->execute([$post['id']]);
    $commentsRows = $commentsStmt->fetchAll();

    $comments = array_map(
        static function (array $comment) use ($db): array {
            return [
                'id' => $comment['id'],
                'userId' => $comment['user_id'],
                'text' => $comment['text'],
                'createdAt' => nowIso($comment['created_at']),
                'author' => userById($db, $comment['user_id']),
            ];
        },
        $commentsRows
    );

    $attachments = attachmentRowsByPostId($db, $post['id']);
    if ($attachments === [] && !empty($post['post_media_data'])) {
        $attachments[] = [
            'name' => $post['post_media_name'] ?? 'attachment',
            'type' => $post['post_media_type'] ?? 'application/octet-stream',
            'data' => $post['post_media_data'],
        ];
    }

    return [
        'id' => $post['id'],
        'userId' => $post['user_id'],
        'content' => $post['content'],
        'attachments' => $attachments,
        'attachment' => $attachments[0] ?? null,
        'likes' => $likes,
        'comments' => $comments,
        'createdAt' => nowIso($post['created_at']),
        'author' => $author,
    ];
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = urldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/');
$script = urldecode($_SERVER['SCRIPT_NAME'] ?? '/api/index.php');
$baseDir = rtrim(str_replace('\\', '/', dirname($script)), '/');
$route = $path;

if ($baseDir !== '' && $baseDir !== '/' && str_starts_with($route, $baseDir)) {
    $route = substr($route, strlen($baseDir));
}

$route = '/' . ltrim($route, '/');

if (str_starts_with($route, '/index.php/')) {
    $route = '/' . ltrim(substr($route, strlen('/index.php/')), '/');
}

if (str_starts_with($route, '/api/')) {
    $route = '/' . ltrim(substr($route, strlen('/api/')), '/');
}

try {
    $db = getDb();
    ensureUserProfileColumns($db);
    ensurePostMediaColumns($db);
    ensurePostAttachmentsTable($db);
    ensureNotificationsTable($db);

    if ($route === '/auth/register' && $method === 'POST') {
        $body = requestBody();
        $username = trim((string)($body['username'] ?? ''));
        $displayName = trim((string)($body['displayName'] ?? ''));
        $email = trim((string)($body['email'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $bio = trim((string)($body['bio'] ?? ''));
        $profilePhoto = normalizeMediaInput($body['profilePhoto'] ?? '');
        $coverPhoto = normalizeMediaInput($body['coverPhoto'] ?? '');

        if ($username === '' || $email === '' || $password === '') {
            respond(['message' => 'All fields are required'], 400);
        }

        if ($displayName === '') {
            $displayName = $username;
        }

        $exists = $db->prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1');
        $exists->execute([$email]);
        if ($exists->fetch()) {
            respond(['message' => 'Email already registered'], 409);
        }

        $userId = uid('usr');
        $insert = $db->prepare('INSERT INTO users (id, username, display_name, email, password_hash, bio, profile_photo_url, cover_photo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $insert->execute([$userId, $username, $displayName, $email, password_hash($password, PASSWORD_DEFAULT), $bio, $profilePhoto, $coverPhoto]);

        $user = userById($db, $userId);
        respond(['user' => $user], 201);
    }

    if ($route === '/auth/login' && $method === 'POST') {
        $body = requestBody();
        $email = trim((string)($body['email'] ?? ''));
        $password = (string)($body['password'] ?? '');

        $stmt = $db->prepare('SELECT id, password_hash FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1');
        $stmt->execute([$email]);
        $userRow = $stmt->fetch();

        if (!$userRow || !password_verify($password, $userRow['password_hash'])) {
            respond(['message' => 'Invalid credentials'], 401);
        }

        $user = userById($db, $userRow['id']);
        respond([
            'token' => 'db-token:' . $userRow['id'],
            'user' => $user,
        ]);
    }

    if ($route === '/users/me' && $method === 'GET') {
        $me = requireAuthUser($db);
        respond(['user' => $me]);
    }

    if ($route === '/users/me/profile' && ($method === 'PUT' || $method === 'PATCH')) {
        $me = requireAuthUser($db);
        $body = requestBody();

        $displayName = trim((string)($body['displayName'] ?? ''));
        $bio = trim((string)($body['bio'] ?? ''));
        $profilePhoto = normalizeMediaInput($body['profilePhoto'] ?? '');
        $coverPhoto = normalizeMediaInput($body['coverPhoto'] ?? '');

        if ($displayName === '') {
            respond(['message' => 'Display name is required'], 400);
        }

        $update = $db->prepare('UPDATE users SET display_name = ?, bio = ?, profile_photo_url = ?, cover_photo_url = ? WHERE id = ?');
        $update->execute([$displayName, $bio, $profilePhoto, $coverPhoto, $me['id']]);

        respond(['user' => userById($db, $me['id'])]);
    }

    if ($route === '/users/suggestions' && $method === 'GET') {
        $me = requireAuthUser($db);
        respond(['users' => suggestedUsers($db, $me['id'])]);
    }

    if ($route === '/users/search' && $method === 'GET') {
        $me = requireAuthUser($db);
        $query = trim((string)($_GET['q'] ?? ''));
        respond(['users' => searchUsers($db, $query, $me['id'])]);
    }

    if ($route === '/notifications' && $method === 'GET') {
        $me = requireAuthUser($db);
        respond([
            'notifications' => notificationsForUser($db, $me['id']),
            'unreadCount' => unreadNotificationCount($db, $me['id']),
        ]);
    }

    if ($route === '/notifications/read-all' && ($method === 'PUT' || $method === 'PATCH')) {
        $me = requireAuthUser($db);
        $stmt = $db->prepare('UPDATE notifications SET is_read = 1, read_at = UTC_TIMESTAMP() WHERE user_id = ? AND is_read = 0');
        $stmt->execute([$me['id']]);

        respond([
            'notifications' => notificationsForUser($db, $me['id']),
            'unreadCount' => unreadNotificationCount($db, $me['id']),
        ]);
    }

    if (preg_match('#^/notifications/([^/]+)/read$#', $route, $m) && ($method === 'PUT' || $method === 'PATCH')) {
        $me = requireAuthUser($db);
        $notificationId = $m[1];

        $stmt = $db->prepare('UPDATE notifications SET is_read = 1, read_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?');
        $stmt->execute([$notificationId, $me['id']]);

        respond([
            'notifications' => notificationsForUser($db, $me['id']),
            'unreadCount' => unreadNotificationCount($db, $me['id']),
        ]);
    }

    if ($route === '/posts' && $method === 'GET') {
        $stmt = $db->query('SELECT id, user_id, content, post_media_name, post_media_type, post_media_data, created_at FROM posts ORDER BY created_at DESC');
        $posts = array_map(static fn (array $post) => enrichPost($db, $post), $stmt->fetchAll());
        respond(['posts' => $posts]);
    }

    if ($route === '/posts' && $method === 'POST') {
        $me = requireAuthUser($db);
        $body = requestBody();
        $content = trim((string)($body['content'] ?? ''));
        $attachments = normalizeAttachmentInputs($body);

        if ($content === '' && $attachments === []) {
            respond(['message' => 'Post content or attachment is required'], 400);
        }

        $postId = uid('pst');
        $legacyAttachment = $attachments[0] ?? null;
        $insert = $db->prepare('INSERT INTO posts (id, user_id, content, post_media_name, post_media_type, post_media_data) VALUES (?, ?, ?, ?, ?, ?)');
        $insert->execute([
            $postId,
            $me['id'],
            $content,
            $legacyAttachment['name'] ?? null,
            $legacyAttachment['type'] ?? null,
            $legacyAttachment['data'] ?? null,
        ]);

        if ($attachments !== []) {
            $insertAttachment = $db->prepare('INSERT INTO post_attachments (id, post_id, file_name, file_type, file_data) VALUES (?, ?, ?, ?, ?)');
            foreach ($attachments as $attachment) {
                $insertAttachment->execute([
                    uid('pat'),
                    $postId,
                    $attachment['name'],
                    $attachment['type'],
                    $attachment['data'],
                ]);
            }
        }

        notifyFollowersOnPost($db, $me['id'], $postId);

        $stmt = $db->prepare('SELECT id, user_id, content, post_media_name, post_media_type, post_media_data, created_at FROM posts WHERE id = ? LIMIT 1');
        $stmt->execute([$postId]);
        $post = $stmt->fetch();

        respond(['post' => enrichPost($db, $post)], 201);
    }

    if (preg_match('#^/users/([^/]+)$#', $route, $m) && $method === 'GET') {
        $user = userById($db, $m[1]);
        if (!$user) {
            respond(['message' => 'User not found'], 404);
        }
        respond(['user' => $user]);
    }

    if (preg_match('#^/users/([^/]+)/posts$#', $route, $m) && $method === 'GET') {
        $userId = $m[1];
        $stmt = $db->prepare('SELECT id, user_id, content, post_media_name, post_media_type, post_media_data, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC');
        $stmt->execute([$userId]);
        $posts = array_map(static fn (array $post) => enrichPost($db, $post), $stmt->fetchAll());
        respond(['posts' => $posts]);
    }

    if (preg_match('#^/users/([^/]+)/followers$#', $route, $m) && $method === 'GET') {
        $target = userById($db, $m[1]);
        if (!$target) {
            respond(['message' => 'User not found'], 404);
        }
        $followers = usersFromIds($db, followerIds($db, $target['id']));
        respond(['users' => $followers]);
    }

    if (preg_match('#^/users/([^/]+)/following$#', $route, $m) && $method === 'GET') {
        $target = userById($db, $m[1]);
        if (!$target) {
            respond(['message' => 'User not found'], 404);
        }
        $following = usersFromIds($db, followingIds($db, $target['id']));
        respond(['users' => $following]);
    }

    if (preg_match('#^/users/([^/]+)/follow$#', $route, $m) && ($method === 'POST' || $method === 'DELETE')) {
        $me = requireAuthUser($db);
        $targetId = $m[1];
        $target = userById($db, $targetId);

        if (!$target) {
            respond(['message' => 'User not found'], 404);
        }

        if ($targetId === $me['id']) {
            respond(['message' => 'Cannot follow yourself'], 400);
        }

        if ($method === 'POST') {
            $insert = $db->prepare('INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)');
            $insert->execute([$me['id'], $targetId]);
        } else {
            $delete = $db->prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?');
            $delete->execute([$me['id'], $targetId]);
        }

        respond([
            'user' => userById($db, $targetId),
            'me' => userById($db, $me['id']),
        ]);
    }

    if (preg_match('#^/posts/([^/]+)/likes$#', $route, $m) && ($method === 'POST' || $method === 'DELETE')) {
        $me = requireAuthUser($db);
        $postId = $m[1];

        $exists = $db->prepare('SELECT id, user_id, content, post_media_name, post_media_type, post_media_data, created_at FROM posts WHERE id = ? LIMIT 1');
        $exists->execute([$postId]);
        $post = $exists->fetch();

        if (!$post) {
            respond(['message' => 'Post not found'], 404);
        }

        if ($method === 'POST') {
            $insert = $db->prepare('INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)');
            $insert->execute([$postId, $me['id']]);
        } else {
            $delete = $db->prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?');
            $delete->execute([$postId, $me['id']]);
        }

        respond(['post' => enrichPost($db, $post)]);
    }

    if (preg_match('#^/posts/([^/]+)/comments$#', $route, $m) && $method === 'POST') {
        $me = requireAuthUser($db);
        $postId = $m[1];
        $body = requestBody();
        $text = trim((string)($body['text'] ?? ''));

        if ($text === '') {
            respond(['message' => 'Comment text is required'], 400);
        }

        $postCheck = $db->prepare('SELECT id FROM posts WHERE id = ? LIMIT 1');
        $postCheck->execute([$postId]);
        if (!$postCheck->fetch()) {
            respond(['message' => 'Post not found'], 404);
        }

        $commentId = uid('cmt');
        $insert = $db->prepare('INSERT INTO comments (id, post_id, user_id, text) VALUES (?, ?, ?, ?)');
        $insert->execute([$commentId, $postId, $me['id'], $text]);

        notifyMentionsOnComment($db, $me['id'], $postId, $commentId, $text);

        $postStmt = $db->prepare('SELECT id, user_id, content, post_media_name, post_media_type, post_media_data, created_at FROM posts WHERE id = ? LIMIT 1');
        $postStmt->execute([$postId]);
        $post = $postStmt->fetch();

        respond(['post' => enrichPost($db, $post)], 201);
    }

    respond(['message' => 'Not found'], 404);
} catch (Throwable $e) {
    respond(['message' => 'Server error'], 500);
}
