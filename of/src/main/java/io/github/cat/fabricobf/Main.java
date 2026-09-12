package io.github.cat.fabricobf;

import io.github.cat.fabricobf.cli.FabricObfCommand;
import picocli.CommandLine;

import javax.swing.JFileChooser;
import javax.swing.JOptionPane;
import javax.swing.filechooser.FileNameExtensionFilter;
import java.io.File;

public final class Main {
    private Main() {
    }

    public static void main(String[] args) {
        if (args.length == 0) {
            runGui();
        } else {
            int code = new CommandLine(new FabricObfCommand()).execute(args);
            System.exit(code);
        }
    }

    private static void runGui() {
        try {
            javax.swing.UIManager.setLookAndFeel(javax.swing.UIManager.getSystemLookAndFeelClassName());
        } catch (Exception ignored) {
        }
        
        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("Select Fabric Mod Jar to Obfuscate");
        chooser.setFileFilter(new FileNameExtensionFilter("JAR Files", "jar"));
        
        if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
            File input = chooser.getSelectedFile();
            String name = input.getName();
            String outName = name.replace(".jar", "-obf.jar");
            if (!name.endsWith(".jar")) outName = name + "-obf.jar";
            File output = new File(input.getParentFile(), outName);
            
            String[] options = {"Aggressive", "Max", "Ultra", "Insane"};
            int choice = JOptionPane.showOptionDialog(null, 
                "Select Obfuscation Level", 
                "fabric-obf", 
                JOptionPane.DEFAULT_OPTION, 
                JOptionPane.QUESTION_MESSAGE, 
                null, 
                options, 
                options[0]);
                
            if (choice == -1) {
                System.exit(0);
            }
            
            String levelOption = "--" + options[choice].toLowerCase();
            
            String[] newArgs = {
                "--in", input.getAbsolutePath(),
                "--out", output.getAbsolutePath(),
                levelOption
            };
            
            JOptionPane.showMessageDialog(null, "Obfuscating...\nThis may take a moment. Press OK to start.");
            
            int code = new CommandLine(new FabricObfCommand()).execute(newArgs);
            if (code == 0) {
                JOptionPane.showMessageDialog(null, "Obfuscation complete!\nSaved as: " + output.getName());
            } else {
                JOptionPane.showMessageDialog(null, "Obfuscation failed! Check console/logs.", "Error", JOptionPane.ERROR_MESSAGE);
            }
            System.exit(code);
        } else {
            System.exit(0);
        }
    }
}

