package com.bbzrdeck.lernraumvr

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import com.bbzrdeck.lernraumvr.core.DeviceInfo
import com.bbzrdeck.lernraumvr.core.DeviceStatus

class AndroidDeviceStatus(private val context: Context) : DeviceStatus {
    override fun freeBytes(): Long? = runCatching {
        StatFs(Environment.getExternalStorageDirectory().path).availableBytes
    }.getOrNull()

    override fun batteryPercent(): Int? = runCatching {
        val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }
    }.getOrNull()

    override fun appVersion(): String = BuildConfig.VERSION_NAME

    override fun androidVersion(): String = Build.VERSION.RELEASE

    fun deviceInfo(): DeviceInfo = DeviceInfo(model = Build.MODEL, androidVersion = Build.VERSION.RELEASE, appVersion = BuildConfig.VERSION_NAME)
}
