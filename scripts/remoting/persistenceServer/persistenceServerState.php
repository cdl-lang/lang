<html>
  <head>
    <style type="text/css">
    .tg  {border-collapse:collapse;border-spacing:0;}
    .tg td{font-family:Arial, sans-serif;font-size:14px;padding:10px 5px;border-style:solid;border-width:1px;overflow:hidden;word-break:normal;}
    .tg th{font-family:Arial, sans-serif;font-size:14px;font-weight:normal;padding:10px 5px;border-style:solid;border-width:1px;overflow:hidden;word-break:normal;}
    .tg .tg-headertext{font-weight:bold;vertical-align:top}
    .tg .tg-celltext{vertical-align:top}
    .tg .tg-cellprofile{color:black;}
    .tg .tg-cellrunning{color:black;}
    .tg .tg-celldown{color:red;}
    </style>
  </head>
  <body>
    <table class="tg">
    <tr>
        <th class="tg-headertext">profile</th>
        <th class="tg-headertext">running</th>
        <th class="tg-headertext">last restart</th>
    </tr>

<?php

function getStatus($pid) {
    return posix_getpgid($pid) > 0? "running": "down";
}

function statusRowFor($name, $pidFileName) {
    echo "<tr>";
    echo "<td class=\"tg-celltext tg-cellprofile\">$name</td>";
    $pid = intval(file_get_contents($pidFileName));
    $status = getStatus($pid);
    echo "<td class=\"tg-celltext tg-cell$status\">$status</td>";
    $mdt = date("d-m-Y H:i:s", filemtime($pidFileName));
    echo "<td class=\"tg-celltext tg-cell$status\">$mdt</td>";
    echo "</tr>\n";
}

function getBuildStatus($buildStatusFileName) {
    $json = json_decode(file_get_contents("/usr/local/share/info/autobuild_status"), true);
    $isRunning = $json['RUNNING'];
    if ($isRunning) {
        $rev = $json['REVISION_NUMBER'];
        $stage = $json['STAGE'];
        $timestamp = $json['TIMESTAMP'];
        return "building r" . $rev . " " . $stage . " " . $timestamp;
    } else {
        return "waiting";
    }
}

# First check profile manager
$profileMgrPersistenceServerPidFileName = "/var/www/data/profileMgr/pserver/persistenceServer.pid";
if (file_exists($profileMgrPersistenceServerPidFileName)) {
    statusRowFor("profileMgr persistenceServer", $profileMgrPersistenceServerPidFileName);
}
$profileMgtAgentPidFileName = "/var/www/data/profileMgr/profileMgtAgent/profileMgtAgent.pid";
if (file_exists($profileMgtAgentPidFileName)) {
    statusRowFor("profileMgtAgent", $profileMgtAgentPidFileName);
}

# Get names of all profiles' persistence servers pid files
$profileList = shell_exec('ls -1 /var/www/data/*/*/pserver/persistenceServer.pid');

$profilePidFileNames = explode("\n", $profileList);

foreach ($profilePidFileNames as $profilePidFileName) {
    if ($profilePidFileName != "") {
        statusRowFor(substr(substr($profilePidFileName, 14), 0, -30), $profilePidFileName);
    }
}

?>
    </table>

<?php
$buildStatusFileName = "/usr/local/share/info/autobuild_status";
if (file_exists($buildStatusFileName)) {
    echo "<p style=\"font-family:Arial,sans-serif;font-size:14px;font-weight:normal;padding:10px 5px;\">";
    echo "Build status: ". getBuildStatus($buildStatusFileName);
}
?>

    <p style="font-family:Arial,sans-serif;font-size:14px;font-weight:normal;padding:10px 5px;">
    MongoDB status:
<?php
    echo shell_exec("service mongod status");
?>

    <p style="font-family:Arial,sans-serif;font-size:14px;font-weight:normal;padding:10px 5px;">
    Last backup:
<?php
    echo file_get_contents("/var/www/beta_last_bk.log");
?>
    </p>
  </body>
</html>
