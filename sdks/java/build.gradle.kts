plugins {
    `java-library`
    `maven-publish`
}

group = "ai.agentlens"
version = "0.1.0"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
    withSourcesJar()
    withJavadocJar()
}

repositories {
    mavenCentral()
}

dependencies {
    // Runtime: Jackson for JSON
    api("com.fasterxml.jackson.core:jackson-databind:2.17.0")
    api("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.0")

    // Test
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])

            pom {
                name.set("AgentLens SDK")
                description.set("Java SDK for the AgentLens AI agent observability platform")
                url.set("https://github.com/agentkitai/agentlens")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        id.set("agentkit")
                        name.set("AgentKit Team")
                    }
                }
                scm {
                    connection.set("scm:git:git://github.com/agentkitai/agentlens.git")
                    developerConnection.set("scm:git:ssh://github.com/agentkitai/agentlens.git")
                    url.set("https://github.com/agentkitai/agentlens")
                }
            }
        }
    }
}
