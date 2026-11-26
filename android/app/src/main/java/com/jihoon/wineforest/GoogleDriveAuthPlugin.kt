package com.jihoon.wineforest

import android.accounts.Account
import android.app.Activity
import android.content.Context
import android.content.IntentSender
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope

@CapacitorPlugin(name = "GoogleDriveAuth")
class GoogleDriveAuthPlugin : Plugin() {

    companion object {
        private const val DRIVE_SCOPE_URI = "https://www.googleapis.com/auth/drive.file"
        private const val PREFS_NAME = "jh_wine_forest_auth"
        private const val PREF_SIGNED_IN = "signed_in"
        private const val PREF_ACCOUNT_EMAIL = "account_email"
    }

    private val driveScope = Scope(DRIVE_SCOPE_URI)
    private lateinit var authLauncher: ActivityResultLauncher<IntentSenderRequest>
    private var pendingAuthCallId: String? = null
    private var lastAccessToken: String? = null
    private var lastAccount: Account? = null

    override fun load() {
        super.load()
        val savedEmail = getPersistedEmail()
        if (!savedEmail.isNullOrBlank()) {
            lastAccount = Account(savedEmail, "com.google")
        }
        authLauncher = bridge.registerForActivityResult(
            ActivityResultContracts.StartIntentSenderForResult(),
        ) { result ->
            handleAuthorizationActivityResult(result)
        }
    }

    private fun isSessionPersisted(): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(PREF_SIGNED_IN, false)
    }

    private fun getPersistedEmail(): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(PREF_ACCOUNT_EMAIL, null)?.takeIf { it.isNotBlank() }
    }

    private fun setSessionPersisted(signedIn: Boolean, email: String? = null) {
        val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_SIGNED_IN, signedIn)
        if (!signedIn) {
            editor.remove(PREF_ACCOUNT_EMAIL)
        } else if (!email.isNullOrBlank()) {
            editor.putString(PREF_ACCOUNT_EMAIL, email.trim())
        }
        editor.apply()
    }

    private fun releasePendingCall(rejectMessage: String? = null, rejectCode: String? = null): PluginCall? {
        val callId = pendingAuthCallId
        pendingAuthCallId = null
        if (callId == null) return null
        val saved = bridge.getSavedCall(callId)
        if (saved != null) {
            if (rejectMessage != null) {
                saved.reject(rejectMessage, rejectCode)
            }
            bridge.releaseCall(saved)
        }
        return saved
    }

    private fun buildAuthorizationRequest(): AuthorizationRequest {
        return AuthorizationRequest.builder()
            .setRequestedScopes(listOf(driveScope))
            .build()
    }

    private fun isTransientNetworkError(e: Exception): Boolean {
        if (e is ApiException) {
            if (e.statusCode == CommonStatusCodes.NETWORK_ERROR ||
                e.statusCode == CommonStatusCodes.TIMEOUT ||
                e.statusCode == CommonStatusCodes.INTERRUPTED
            ) {
                return true
            }
        }
        val msg = (e.localizedMessage ?: e.message ?: "").uppercase()
        return msg.contains("NETWORK") ||
            msg.contains("OFFLINE") ||
            msg.contains("TIMEOUT") ||
            msg.contains("TIMED OUT") ||
            msg.contains("CONNECTION")
    }

    private fun buildSuccessPayload(result: AuthorizationResult, token: String): JSObject {
        @Suppress("DEPRECATION")
        val legacyAccount = try {
            result.toGoogleSignInAccount()
        } catch (_: Exception) {
            null
        }
        val email = legacyAccount?.email?.takeIf { it.isNotBlank() } ?: getPersistedEmail()
        val accountObj = legacyAccount?.account ?: email?.let { Account(it, "com.google") }
        if (accountObj != null) {
            lastAccount = accountObj
        }
        lastAccessToken = token
        setSessionPersisted(true, email)

        val ret = JSObject()
        ret.put("signedIn", true)
        ret.put("accessToken", token)
        if (!email.isNullOrBlank()) {
            ret.put("email", email)
        }
        return ret
    }

    private fun hasDriveScope(result: AuthorizationResult): Boolean {
        val granted = result.grantedScopes
        return granted.isEmpty() || granted.contains(DRIVE_SCOPE_URI)
    }

    private fun handleAuthorizationActivityResult(result: ActivityResult) {
        val callId = pendingAuthCallId
        pendingAuthCallId = null
        val call = if (callId != null) bridge.getSavedCall(callId) else null

        val currentActivity = activity
        if (result.resultCode != Activity.RESULT_OK || currentActivity == null) {
            if (call != null) {
                call.reject("USER_CANCELLED: 사용자가 구글 로그인을 취소했습니다.", "USER_CANCELLED")
                bridge.releaseCall(call)
            }
            return
        }

        try {
            val authResult = Identity.getAuthorizationClient(currentActivity)
                .getAuthorizationResultFromIntent(result.data)
            val token = authResult.accessToken
            if (token.isNullOrBlank()) {
                if (call != null) {
                    call.reject("SIGN_IN_FAILED: 액세스 토큰을 받지 못했습니다.", "SIGN_IN_FAILED")
                    bridge.releaseCall(call)
                }
                return
            }
            if (!hasDriveScope(authResult)) {
                setSessionPersisted(false)
                if (call != null) {
                    call.reject("SCOPE_DENIED: Google Drive 권한이 허용되지 않았습니다.", "SCOPE_DENIED")
                    bridge.releaseCall(call)
                }
                return
            }
            // 저메모리 재생성으로 call == null인 경우에도 세션 플래그/이메일을 저장해 재부팅 restoreSession이 즉시 복구
            val payload = buildSuccessPayload(authResult, token)
            if (call != null) {
                call.resolve(payload)
                bridge.releaseCall(call)
            }
        } catch (e: Exception) {
            if (call != null) {
                call.reject("SIGN_IN_FAILED: ${e.localizedMessage ?: "인증 처리 실패"}", "SIGN_IN_FAILED")
                bridge.releaseCall(call)
            }
        }
    }

    @PluginMethod
    fun signIn(call: PluginCall) {
        val currentActivity = activity
        if (currentActivity == null) {
            call.reject("활성 화면(Activity)을 찾을 수 없습니다.", "NO_ACTIVITY")
            return
        }

        Identity.getAuthorizationClient(currentActivity)
            .authorize(buildAuthorizationRequest())
            .addOnSuccessListener { authResult ->
                if (authResult.hasResolution()) {
                    val pendingIntent = authResult.pendingIntent
                    if (pendingIntent == null) {
                        call.reject("SIGN_IN_FAILED: 권한 요청 화면을 열 수 없습니다.", "SIGN_IN_FAILED")
                        return@addOnSuccessListener
                    }
                    currentActivity.runOnUiThread {
                        releasePendingCall(
                            "USER_CANCELLED: 새 로그인 요청으로 취소되었습니다.",
                            "USER_CANCELLED",
                        )
                        bridge.saveCall(call)
                        pendingAuthCallId = call.callbackId
                        try {
                            val req = IntentSenderRequest.Builder(pendingIntent.intentSender).build()
                            authLauncher.launch(req)
                        } catch (e: IntentSender.SendIntentException) {
                            releasePendingCall()
                            call.reject("SIGN_IN_FAILED: ${e.localizedMessage}", "SIGN_IN_FAILED")
                        } catch (e: Exception) {
                            releasePendingCall()
                            call.reject("SIGN_IN_FAILED: ${e.localizedMessage ?: "권한 화면 실행 실패"}", "SIGN_IN_FAILED")
                        }
                    }
                } else {
                    val token = authResult.accessToken
                    if (token.isNullOrBlank()) {
                        call.reject("SIGN_IN_FAILED: 액세스 토큰이 비어 있습니다.", "SIGN_IN_FAILED")
                        return@addOnSuccessListener
                    }
                    if (!hasDriveScope(authResult)) {
                        setSessionPersisted(false)
                        call.reject("SCOPE_DENIED: Google Drive 권한이 허용되지 않았습니다.", "SCOPE_DENIED")
                        return@addOnSuccessListener
                    }
                    call.resolve(buildSuccessPayload(authResult, token))
                }
            }
            .addOnFailureListener { e ->
                call.reject("SIGN_IN_FAILED: ${e.localizedMessage ?: "구글 로그인 실패"}", "SIGN_IN_FAILED")
            }
    }

    @PluginMethod
    fun restoreSession(call: PluginCall) {
        if (!isSessionPersisted()) {
            call.resolve(JSObject().put("signedIn", false))
            return
        }

        val currentActivity = activity
        if (currentActivity == null) {
            call.resolve(JSObject().put("signedIn", false))
            return
        }

        Identity.getAuthorizationClient(currentActivity)
            .authorize(buildAuthorizationRequest())
            .addOnSuccessListener { authResult ->
                val token = authResult.accessToken
                if (!authResult.hasResolution() && !token.isNullOrBlank() && hasDriveScope(authResult)) {
                    call.resolve(buildSuccessPayload(authResult, token))
                } else {
                    call.resolve(JSObject().put("signedIn", false))
                }
            }
            .addOnFailureListener {
                call.resolve(JSObject().put("signedIn", false))
            }
    }

    @PluginMethod
    fun getAccessToken(call: PluginCall) {
        val currentActivity = activity
        if (currentActivity == null) {
            call.reject("SESSION_EXPIRED: 활성 화면을 찾을 수 없습니다.", "SESSION_EXPIRED")
            return
        }

        val forceRefresh = call.getBoolean("forceRefresh", false) ?: false
        val client = Identity.getAuthorizationClient(currentActivity)

        val runAuthorize = {
            client.authorize(buildAuthorizationRequest())
                .addOnSuccessListener { authResult ->
                    if (authResult.hasResolution()) {
                        setSessionPersisted(false)
                        call.reject("SESSION_EXPIRED: 사용자 재동의가 필요합니다.", "SESSION_EXPIRED")
                        return@addOnSuccessListener
                    }
                    val token = authResult.accessToken
                    if (token.isNullOrBlank()) {
                        call.reject("SESSION_EXPIRED: 토큰을 갱신할 수 없습니다.", "SESSION_EXPIRED")
                        return@addOnSuccessListener
                    }
                    if (!hasDriveScope(authResult)) {
                        setSessionPersisted(false)
                        call.reject("SCOPE_DENIED: Google Drive 권한이 필요합니다.", "SCOPE_DENIED")
                        return@addOnSuccessListener
                    }
                    call.resolve(buildSuccessPayload(authResult, token))
                }
                .addOnFailureListener { e ->
                    if (isTransientNetworkError(e)) {
                        call.reject(
                            "NETWORK_ERROR: ${e.localizedMessage ?: "네트워크 연결이 불안정해 토큰을 갱신할 수 없습니다."}",
                            "NETWORK_ERROR",
                        )
                    } else {
                        call.reject("SESSION_EXPIRED: ${e.localizedMessage ?: "토큰 갱신 실패"}", "SESSION_EXPIRED")
                    }
                }
        }

        val cachedToken = lastAccessToken
        if (forceRefresh && !cachedToken.isNullOrBlank()) {
            lastAccessToken = null
            val clearReq = ClearTokenRequest.builder().setToken(cachedToken).build()
            client.clearToken(clearReq).addOnCompleteListener {
                runAuthorize()
            }
        } else {
            runAuthorize()
        }
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        val persistedEmail = getPersistedEmail()
        setSessionPersisted(false)
        val tokenToClear = lastAccessToken
        val accountToRevoke = lastAccount ?: persistedEmail?.let { Account(it, "com.google") }
        lastAccessToken = null
        lastAccount = null

        val currentActivity = activity
        if (currentActivity == null) {
            call.resolve()
            return
        }

        val client = Identity.getAuthorizationClient(currentActivity)
        val finishSignOut = {
            if (accountToRevoke != null) {
                val revokeReq = RevokeAccessRequest.builder()
                    .setAccount(accountToRevoke)
                    .setScopes(listOf(driveScope))
                    .build()
                client.revokeAccess(revokeReq).addOnCompleteListener {
                    call.resolve()
                }
            } else {
                call.resolve()
            }
        }

        if (!tokenToClear.isNullOrBlank()) {
            val clearReq = ClearTokenRequest.builder().setToken(tokenToClear).build()
            client.clearToken(clearReq).addOnCompleteListener {
                finishSignOut()
            }
        } else {
            finishSignOut()
        }
    }
}
