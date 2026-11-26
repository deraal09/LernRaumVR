package com.bbzrdeck.lernraumvr

import android.content.Context
import com.bbzrdeck.lernraumvr.core.TokenStore

/** Gerätetoken in den privaten SharedPreferences der App (für andere Apps nicht lesbar). */
class PrefsTokenStore(context: Context) : TokenStore {
    private val prefs = context.applicationContext.getSharedPreferences("lernraumvr", Context.MODE_PRIVATE)

    override fun get(): String? = prefs.getString(KEY, null)

    override fun set(token: String?) {
        prefs.edit().apply { if (token == null) remove(KEY) else putString(KEY, token) }.apply()
    }

    private companion object {
        const val KEY = "device_token"
    }
}
