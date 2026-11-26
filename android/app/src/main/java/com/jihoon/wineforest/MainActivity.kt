package com.jihoon.wineforest

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // CRITICAL: Capacitor 브릿지가 로컬 플러그인을 인식하려면 super.onCreate 이전에 등록해야 합니다.
        registerPlugin(GoogleDriveAuthPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
