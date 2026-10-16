package com.lios.nativeclient

// Adapted from OpenClaw DeviceIdentityStore.kt at c074824a (MIT; see NOTICE).
// Android Keystore does not promise Ed25519 support. Only AES wrapping is
// non-exportable; Ed25519 signing briefly unwraps a seed into process memory.
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
internal fun unb64(text: String): ByteArray = Base64.decode(text, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
internal fun sha(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)
internal fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }

class ProtectedStore(context: Context) {
    private val prefs = context.getSharedPreferences("lios.keystore.wrapped.v1", Context.MODE_PRIVATE)
    private val key: SecretKey
    init {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "lios.device.wrap.v1"
        if (!store.containsAlias(alias)) {
            check(prefs.all.isEmpty()) { "Keystore key is missing. Clear app data and re-pair; encrypted identity cannot be restored." }
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).build())
                generateKey()
            }
        }
        key = store.getKey(alias, null) as SecretKey
    }
    @Synchronized fun get(name: String): ByteArray? {
        val encoded = prefs.getString(name, null) ?: return null
        val packet = unb64(encoded)
        check(packet.size >= 28) { "Encrypted storage damaged" }
        return Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, packet.copyOfRange(0, 12)))
            updateAAD(name.toByteArray(Charsets.UTF_8))
            doFinal(packet, 12, packet.size - 12)
        }
    }
    @Synchronized fun put(name: String, bytes: ByteArray?) {
        if (bytes == null) { check(prefs.edit().remove(name).commit()); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString(name, b64(cipher.iv + cipher.doFinal(bytes))).commit()) { "Cannot persist encrypted storage" }
    }
    fun text(name: String): String? = get(name)?.let { bytes -> try { String(bytes, Charsets.UTF_8) } finally { bytes.fill(0) } }
    fun text(name: String, value: String?) = put(name, value?.toByteArray(Charsets.UTF_8))
}

class DeviceIdentity(private val store: ProtectedStore) {
    val publicKey: String
    val deviceId: String
    init {
        var seed = store.get("identity.seed")
        if (seed == null) {
            seed = ByteArray(32).also { SecureRandom().nextBytes(it) }
            store.put("identity.seed", seed)
        }
        try {
            check(seed.size == 32)
            val raw = Ed25519PrivateKeyParameters(seed, 0).generatePublicKey().encoded
            publicKey = b64(raw)
            deviceId = hex(sha(raw).copyOfRange(0, 16))
        } finally { seed.fill(0) }
    }
    fun sign(payload: String): String {
        val seed = checkNotNull(store.get("identity.seed"))
        try {
            val bytes = payload.toByteArray(Charsets.UTF_8)
            return Ed25519Signer().run {
                init(true, Ed25519PrivateKeyParameters(seed, 0))
                update(bytes, 0, bytes.size)
                b64(generateSignature())
            }
        } finally { seed.fill(0) }
    }
}
