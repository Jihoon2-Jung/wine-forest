import Foundation
import Capacitor
import GoogleSignIn

@objc(GoogleDriveAuthPlugin)
public class GoogleDriveAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoogleDriveAuthPlugin"
    public let jsName = "GoogleDriveAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAccessToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise)
    ]

    private let driveScope = "https://www.googleapis.com/auth/drive.file"

    private func isClientIdConfigured() -> Bool {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String else {
            return false
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !trimmed.contains("YOUR_IOS_CLIENT_ID"),
              !trimmed.hasPrefix("$("),
              trimmed.hasSuffix(".apps.googleusercontent.com") else {
            return false
        }
        let suffix = ".apps.googleusercontent.com"
        let prefix = String(trimmed.dropLast(suffix.count))
        guard !prefix.isEmpty else { return false }
        let expectedScheme = "com.googleusercontent.apps.\(prefix)"
        guard let urlTypes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] else {
            return false
        }
        let registeredSchemes = urlTypes.flatMap { ($0["CFBundleURLSchemes"] as? [String]) ?? [] }
        return registeredSchemes.contains(expectedScheme)
    }

    private func hasDriveScope(_ user: GIDGoogleUser) -> Bool {
        return user.grantedScopes?.contains(driveScope) == true
    }

    private func sessionPayload(for user: GIDGoogleUser) -> [String: Any] {
        let expiresSeconds = user.accessToken.expirationDate?.timeIntervalSince1970
            ?? (Date().timeIntervalSince1970 + 3600)
        return [
            "signedIn": true,
            "accessToken": user.accessToken.tokenString,
            "expiresAt": Int64(expiresSeconds * 1000),
            "email": user.profile?.email ?? ""
        ]
    }

    @objc func signIn(_ call: CAPPluginCall) {
        guard isClientIdConfigured() else {
            call.reject(
                "iOS Google Client ID(GIDClientID)가 설정되지 않았습니다. GitHub Secrets(GOOGLE_IOS_CLIENT_ID) 또는 Local.xcconfig 설정을 확인해 주세요.",
                "CONFIG_MISSING"
            )
            return
        }

        DispatchQueue.main.async {
            guard let presentingVC = self.bridge?.viewController else {
                call.reject("화면 컨트롤러를 찾을 수 없습니다.", "NO_VIEW_CONTROLLER")
                return
            }

            GIDSignIn.sharedInstance.signIn(
                withPresenting: presentingVC,
                hint: nil,
                additionalScopes: [self.driveScope]
            ) { result, error in
                if let error = error {
                    if let gidErr = error as? GIDSignInError, gidErr.code == .canceled {
                        call.reject("USER_CANCELLED: 사용자가 로그인을 취소했습니다.", "USER_CANCELLED")
                        return
                    }
                    let nsError = error as NSError
                    if nsError.domain == GIDSignInError.errorDomain && nsError.code == GIDSignInError.canceled.rawValue {
                        call.reject("USER_CANCELLED: 사용자가 로그인을 취소했습니다.", "USER_CANCELLED")
                        return
                    }
                    call.reject("구글 로그인 실패: \(error.localizedDescription)", "SIGN_IN_FAILED")
                    return
                }

                guard let user = result?.user else {
                    call.reject("구글 사용자 정보를 가져오지 못했습니다.", "SIGN_IN_FAILED")
                    return
                }

                guard self.hasDriveScope(user) else {
                    GIDSignIn.sharedInstance.signOut()
                    call.reject("SCOPE_DENIED: Google Drive 파일 접근 권한이 허용되지 않았습니다.", "SCOPE_DENIED")
                    return
                }

                call.resolve(self.sessionPayload(for: user))
            }
        }
    }

    @objc func restoreSession(_ call: CAPPluginCall) {
        guard isClientIdConfigured() else {
            call.resolve(["signedIn": false])
            return
        }

        DispatchQueue.main.async {
            GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                if error != nil {
                    call.resolve(["signedIn": false])
                    return
                }

                guard let user = user, self.hasDriveScope(user) else {
                    call.resolve(["signedIn": false])
                    return
                }

                user.refreshTokensIfNeeded { refreshedUser, refreshError in
                    if refreshError != nil {
                        call.resolve(["signedIn": false])
                        return
                    }
                    guard let validUser = refreshedUser else {
                        call.resolve(["signedIn": false])
                        return
                    }
                    call.resolve(self.sessionPayload(for: validUser))
                }
            }
        }
    }

    @objc func getAccessToken(_ call: CAPPluginCall) {
        guard isClientIdConfigured() else {
            call.reject(
                "iOS Google Client ID(GIDClientID) 또는 URL Scheme 설정이 올바르지 않습니다.",
                "CONFIG_MISSING"
            )
            return
        }

        DispatchQueue.main.async {
            let refreshUser: (GIDGoogleUser) -> Void = { user in
                guard self.hasDriveScope(user) else {
                    call.reject("SCOPE_DENIED: Google Drive 권한이 필요합니다.", "SCOPE_DENIED")
                    return
                }

                user.refreshTokensIfNeeded { refreshedUser, error in
                    if let error = error {
                        call.reject("SESSION_EXPIRED: \(error.localizedDescription)", "SESSION_EXPIRED")
                        return
                    }
                    guard let validUser = refreshedUser else {
                        call.reject("SESSION_EXPIRED: 토큰을 갱신할 수 없습니다.", "SESSION_EXPIRED")
                        return
                    }
                    call.resolve(self.sessionPayload(for: validUser))
                }
            }

            if let currentUser = GIDSignIn.sharedInstance.currentUser {
                refreshUser(currentUser)
                return
            }

            GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                if let error = error {
                    call.reject("SESSION_EXPIRED: \(error.localizedDescription)", "SESSION_EXPIRED")
                    return
                }
                guard let restoredUser = user else {
                    call.reject("SESSION_EXPIRED: 저장된 Google 로그인 세션이 없습니다.", "SESSION_EXPIRED")
                    return
                }
                refreshUser(restoredUser)
            }
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            GIDSignIn.sharedInstance.signOut()
            call.resolve()
        }
    }
}
