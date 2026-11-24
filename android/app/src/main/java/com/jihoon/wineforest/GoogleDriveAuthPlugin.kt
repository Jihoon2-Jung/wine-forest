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
import com.google.android.gms.common.api.Scope

@CapacitorPlugin(name = "GoogleDriveAuth")
class GoogleDriveAuthPlugin : Plugin() {

    companion object {
        private const val DRIVE_SCOPE_URI = "https://www.googleapis.com/auth/drive.file"
        private const val PREFS_NAME = "jh_wine_forest_auth"
        private const val PREF_SIGNED_IN = "signed_in"
    }

    private val driveScope = Scope(DRIVE_SCOPE_URI)
    private lateinit var authLauncher: ActivityResultLauncher<IntentSenderRequest>
    private var pendingAuthCall: PluginCall? = null
    private var lastAccessToken: String? = null
    private var lastAccount: Account? = null

    override fun load() {
        super.load()
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

    private fun setSessionPersisted(signedIn: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_SIGNED_IN, signedIn)
            .apply()
    }

    private fun buildAuthorizationRequest(): AuthorizationRequest {
        return AuthorizationRequest.builder()
            .setRequestedScopes(listOf(driveScope))
            .build()
    }

    private fun buildSuccessPayload(result: AuthorizationResult, token: String): JSObject {
        @Suppress("DEPRECATION")
        val legacyAccount = try {
            result.toGoogleSignInAccount()
        } catch (_: Exception) {
            null
        }
        val accountObj = legacyAccount?.account
        if (accountObj != null) {
            lastAccount = accountObj
        }
        lastAccessToken = token
        setSessionPersisted(true)

        val ret = JSObject()
        ret.put("signedIn", true)
        ret.put("accessToken", token)
        val email = legacyAccount?.email
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
        val call = pendingAuthCall
        pendingAuthCall = null
        if (call == null) return

        val currentActivity = activity
        if (result.resultCode != Activity.RESULT_OK || currentActivity == null) {
            call.reject("USER_CANCELLED: 사용자가 구글 로그인을 취소했습니다.", "USER_CANCELLED")
            return
        }

        try {
            val authResult = Identity.getAuthorizationClient(currentActivity)
                .getAuthorizationResultFromIntent(result.data)
            val token = authResult.accessToken
            if (token.isNullOrBlank()) {
                call.reject("SIGN_IN_FAILED: 액세스 토큰을 받지 못했습니다.", "SIGN_IN_FAILED")
                return
            }
            if (!hasDriveScope(authResult)) {
                call.reject("SCOPE_DENIED: Google Drive 권한이 허용되지 않았습니다.", "SCOPE_DENIED")
                return
            }
            call.resolve(buildSuccessPayload(authResult, token))
        } catch (e: Exception) {
            call.reject("SIGN_IN_FAILED: ${e.localizedMessage ?: "인증 처리 실패"}", "SIGN_IN_FAILED")
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
                    pendingAuthCall?.reject("USER_CANCELLED: 새 로그인 요청으로 취소되었습니다.", "USER_CANCELLED")
                    pendingAuthCall = call
                    try {
                        val req = IntentSenderRequest.Builder(pendingIntent.intentSender).build()
                        authLauncher.launch(req)
                    } catch (e: IntentSender.SendIntentException) {
                        pendingAuthCall = null
                        call.reject("SIGN_IN_FAILED: ${e.localizedMessage}", "SIGN_IN_FAILED")
                    }
                } else {
                    val token = authResult.accessToken
                    if (token.isNullOrBlank()) {
                        call.reject("SIGN_IN_FAILED: 액세스 토큰이 비어 있습니다.", "SIGN_IN_FAILED")
                        return@addOnSuccessListener
                    }
                    if (!hasDriveScope(authResult)) {
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
                        call.reject("SESSION_EXPIRED: 사용자 재동의가 필요합니다.", "SESSION_EXPIRED")
                        return@addOnSuccessListener
                    }
                    val token = authResult.accessToken
                    if (token.isNullOrBlank()) {
                        call.reject("SESSION_EXPIRED: 토큰을 갱신할 수 없습니다.", "SESSION_EXPIRED")
                        return@addOnSuccessListener
                    }
                    if (!hasDriveScope(authResult)) {
                        call.reject("SCOPE_DENIED: Google Drive 권한이 필요합니다.", "SCOPE_DENIED")
                        return@addOnSuccessListener
                    }
                    call.resolve(buildSuccessPayload(authResult, token))
                }
                .addOnFailureListener { e ->
                    call.reject("SESSION_EXPIRED: ${e.localizedMessage ?: "토큰 갱신 실패"}", "SESSION_EXPIRED")
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
        setSessionPersisted(false)
        val tokenToClear = lastAccessToken
        val accountToRevoke = lastAccount
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
