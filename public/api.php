<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

// ==========================================
// ETHIO TELECOM LINUX WEB HOSTING CONFIG
// ==========================================
// 1. Enter the database server hostname. If it includes a port (e.g., mysql-db02.remote:32636),
//    you can enter it here, and the script will automatically parse it!
$db_host = 'mysql-db02.remote:32636'; 

// 2. Enter your MySQL database name and user details from Plesk.
$db_name = 'replace_with_database_name'; // Your full database name (e.g., 'pharmac2_db')
$db_user = 'replace_with_database_user'; // Your database username (e.g., 'pharmac2_user')
$db_pass = 'replace_with_database_password'; // Your database user password

try {
    $resolved_host = $db_host;
    $resolved_port = '';
    
    // Auto-detect custom port if provided in host (e.g. mysql-db02.remote:32636)
    if (strpos($db_host, ':') !== false) {
        list($resolved_host, $resolved_port) = explode(':', $db_host, 2);
    }
    
    $dsn = "mysql:host=$resolved_host";
    if (!empty($resolved_port)) {
        $dsn .= ";port=$resolved_port";
    }
    $dsn .= ";dbname=$db_name;charset=utf8mb4";
    
    $pdo = new PDO($dsn, $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Auto-create table on first run
    $pdo->exec("CREATE TABLE IF NOT EXISTS app_data (
        data_key VARCHAR(255) PRIMARY KEY,
        data_value LONGTEXT
    )");
} catch(PDOException $e) {
    if (isset($_GET['action']) && $_GET['action'] == 'health') {
         echo json_encode(["status" => "offline", "error" => "Database connection failed: Please edit api.php credentials"]);
         exit;
    }
    http_response_code(500);
    echo json_encode(["error" => "Database Connection Failed"]);
    exit;
}

$action = $_GET['action'] ?? '';
$key = $_GET['key'] ?? '';

if ($action === 'health') {
    $stmt = $pdo->prepare("SELECT data_value FROM app_data WHERE data_key = 'pharma_info'");
    $stmt->execute();
    $info = $stmt->fetchColumn();
    $name = 'Unset';
    if ($info) {
        $dec = json_decode($info, true);
        if(isset($dec['name'])) $name = $dec['name'];
    }
    echo json_encode(["status" => "online", "pharmacy" => $name, "is_php" => true]);
    exit;
}

if ($action === 'receipt') {
    $stmt = $pdo->prepare("SELECT data_value FROM app_data WHERE data_key = 'pharma_receipt_counter'");
    $stmt->execute();
    $val = $stmt->fetchColumn();
    $next = intval($val) + 1;
    $pdo->prepare("REPLACE INTO app_data (data_key, data_value) VALUES ('pharma_receipt_counter', ?)")->execute([$next]);
    echo json_encode(["receiptNumber" => "R-" . str_pad($next, 6, "0", STR_PAD_LEFT)]);
    exit;
}

if ($action === 'reset' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pdo->exec("TRUNCATE TABLE app_data");
    echo json_encode(["success" => true]);
    exit;
}

if ($action === 'data' && $key) {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $stmt = $pdo->prepare("SELECT data_value FROM app_data WHERE data_key = ?");
        $stmt->execute([$key]);
        $val = $stmt->fetchColumn();
        if ($val) echo $val;
        else echo json_encode([]);
        exit;
    }
    
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = file_get_contents('php://input');
        $incoming = json_decode($body, true);
        
        $finalData = $incoming;
        
        // Emulate the Node.js list merge logic to prevent overwriting
        if (is_array($incoming) && !str_starts_with($key, 'pharma_bincard_')) {
            try {
                $pdo->beginTransaction();
                $stmt = $pdo->prepare("SELECT data_value FROM app_data WHERE data_key = ? FOR UPDATE"); 
                $stmt->execute([$key]);
                $existingStr = $stmt->fetchColumn();
                
                if ($existingStr) {
                    $existing = json_decode($existingStr, true);
                    if (is_array($existing)) {
                        $map = [];
                        foreach ($existing as $item) { if(isset($item['id'])) $map[$item['id']] = $item; }
                        foreach ($incoming as $item) { if(isset($item['id'])) $map[$item['id']] = $item; }
                        $finalData = array_values($map);
                    }
                }
                $stmtInsert = $pdo->prepare("REPLACE INTO app_data (data_key, data_value) VALUES (?, ?)");
                $stmtInsert->execute([$key, json_encode($finalData)]);
                $pdo->commit();
            } catch (Exception $e) {
                $pdo->rollBack();
                $stmtInsert = $pdo->prepare("REPLACE INTO app_data (data_key, data_value) VALUES (?, ?)");
                $stmtInsert->execute([$key, $body]);
            }
        } else {
            $stmtInsert = $pdo->prepare("REPLACE INTO app_data (data_key, data_value) VALUES (?, ?)");
            $stmtInsert->execute([$key, $body]);
        }
        
        echo json_encode(["success" => true]);
        exit;
    }
}

echo json_encode(["error" => "Invalid endpoint"]);
