plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.lios.nativeclient.wear"
    compileSdk = 35
    defaultConfig { applicationId = "com.lios.home"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0.0" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    signingConfigs {
        create("ownerRelease") {
            val path = providers.environmentVariable("LIOS_ANDROID_KEYSTORE").orNull
            if (path != null) {
                storeFile = file(path)
                storePassword = providers.environmentVariable("LIOS_ANDROID_STORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("LIOS_ANDROID_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("LIOS_ANDROID_KEY_PASSWORD").orNull
            }
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("ownerRelease"); isMinifyEnabled = false } }
}
dependencies { implementation(project(":core")) }
