plugins {
    application
    id("com.gradleup.shadow") version "8.3.6"
}

group = "io.github.cat"
version = "1.0.0"

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    implementation("org.ow2.asm:asm:9.8")
    implementation("org.ow2.asm:asm-analysis:9.8")
    implementation("org.ow2.asm:asm-commons:9.8")
    implementation("org.ow2.asm:asm-tree:9.8")
    implementation("org.ow2.asm:asm-util:9.8")
    implementation("info.picocli:picocli:4.7.6")
    implementation("com.google.code.gson:gson:2.11.0")

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

application {
    mainClass.set("io.github.cat.fabricobf.Main")
}

tasks.test {
    useJUnitPlatform()
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = "io.github.cat.fabricobf.Main"
    }
}

tasks.shadowJar {
    archiveBaseName.set("fabric-obf")
    archiveClassifier.set("")
    archiveVersion.set("")
    manifest {
        attributes["Main-Class"] = "io.github.cat.fabricobf.Main"
    }
}

tasks.build {
    dependsOn(tasks.shadowJar)
}

