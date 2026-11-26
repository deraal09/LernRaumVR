plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Server-Adresse wird beim Bauen fest eingebrannt (die Brille hat keine Tastatur).
// Überschreiben: ./gradlew assembleDebug -PserverUrl=https://test.example.org
val serverUrl: String = (project.findProperty("serverUrl") as String?) ?: "https://lernraumvr.bbz-rd-eck.com"

android {
    namespace = "com.bbzrdeck.lernraumvr"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.bbzrdeck.lernraumvr"
        minSdk = 26
        // PICO G2 4K läuft mit Android 8.1 (API 27)
        targetSdk = 27
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Release-Signatur nur, wenn die Zugangsdaten gesetzt sind (CI-Secrets, nie im Repo).
    // Alle Updates der App müssen mit demselben Schlüssel signiert sein.
    val keystorePath = System.getenv("LERNRAUMVR_KEYSTORE")
    if (keystorePath != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("LERNRAUMVR_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("LERNRAUMVR_KEY_ALIAS")
                keyPassword = System.getenv("LERNRAUMVR_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        // targetSdk 27 entspricht dem Gerät; Play-Store-Hinweise sind hier ohne Belang.
        disable += "ExpiredTargetSdkVersion"
    }
}
