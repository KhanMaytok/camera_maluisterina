package com.grabadora.camera.media

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class PendingUpload(
    val eventId: String,
    val videoPath: String?,
    val thumbPath: String?,
    val sizeBytes: Long,
    val retries: Int,
    val nextRetryAt: Long,
)

class UploadDb(context: Context) : SQLiteOpenHelper(context, "uploads.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE pending (
              event_id TEXT PRIMARY KEY,
              video_path TEXT,
              thumb_path TEXT,
              size_bytes INTEGER NOT NULL DEFAULT 0,
              retries INTEGER NOT NULL DEFAULT 0,
              next_retry_at INTEGER NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun insert(eventId: String, videoPath: String?, thumbPath: String?, sizeBytes: Long) {
        val now = System.currentTimeMillis()
        writableDatabase.insertWithOnConflict(
            "pending",
            null,
            ContentValues().apply {
                put("event_id", eventId)
                put("video_path", videoPath)
                put("thumb_path", thumbPath)
                put("size_bytes", sizeBytes)
                put("retries", 0)
                put("next_retry_at", now)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun due(now: Long): List<PendingUpload> {
        val out = mutableListOf<PendingUpload>()
        readableDatabase.query(
            "pending",
            null,
            "next_retry_at <= ?",
            arrayOf(now.toString()),
            null,
            null,
            "next_retry_at",
        ).use { cursor ->
            while (cursor.moveToNext()) {
                out += PendingUpload(
                    eventId = cursor.getString(0),
                    videoPath = cursor.getString(1),
                    thumbPath = cursor.getString(2),
                    sizeBytes = cursor.getLong(3),
                    retries = cursor.getInt(4),
                    nextRetryAt = cursor.getLong(5),
                )
            }
        }
        return out
    }

    fun scheduleRetry(eventId: String, retries: Int) {
        val backoffMs = (30_000L shl minOf(retries, 7)).coerceAtMost(5 * 60_000L)
        writableDatabase.update(
            "pending",
            ContentValues().apply {
                put("retries", retries)
                put("next_retry_at", System.currentTimeMillis() + backoffMs)
            },
            "event_id = ?",
            arrayOf(eventId),
        )
    }

    fun remove(eventId: String) {
        writableDatabase.delete("pending", "event_id = ?", arrayOf(eventId))
    }
}
