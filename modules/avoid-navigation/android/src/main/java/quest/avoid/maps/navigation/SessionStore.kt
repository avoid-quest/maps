package quest.avoid.maps.navigation

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/** One interrupted session, outside Android backup. Stop deletes its destination and route. */
internal class SessionStore(context: Context) {
  private val file = AtomicFile(File(context.noBackupFilesDir, "navigation-session.json"))
  fun save(id: String, destination: Point, mode: String, transitPlan: Map<String, Any?>? = null, origin: Point? = null) {
    val json = JSONObject().put("version", 1).put("sessionId", id).put("mode", mode)
      .put("latitude", destination.latitude).put("longitude", destination.longitude)
    if (transitPlan != null) json.put("transitPlan", JSONObject(transitPlan))
    if (origin != null) json.put("origin", JSONObject(origin.bridge()))
    val bytes = json.toString().toByteArray()
    require(bytes.size <= MAX_BYTES)
    val stream = file.startWrite()
    try { stream.write(bytes); file.finishWrite(stream) } catch (error: Exception) { file.failWrite(stream); throw error }
  }
  fun read(): Map<String, Any?>? = runCatching {
    val bytes = file.openRead().use { stream ->
      val buffer = java.io.ByteArrayOutputStream()
      val chunk = ByteArray(8_192)
      while (true) {
        val count = stream.read(chunk)
        if (count < 0) break
        require(buffer.size() + count <= MAX_BYTES)
        buffer.write(chunk, 0, count)
      }
      buffer.toByteArray()
    }
    val json = JSONObject(bytes.toString(Charsets.UTF_8))
    val point = Point(json.getDouble("latitude"), json.getDouble("longitude"))
    val mode = json.getString("mode")
    val id = json.getString("sessionId")
    require(json.getInt("version") == 1 && point.valid() && mode in setOf("walk", "bicycle", "car", "transit"))
    require(UUID.fromString(id).toString() == id)
    mutableMapOf<String, Any?>("sessionId" to id, "destination" to point.bridge(), "mode" to mode).apply {
      json.optJSONObject("transitPlan")?.let { put("transitPlan", decode(it, 0)) }
      json.optJSONObject("origin")?.let { put("origin", decode(it, 0)) }
    }
  }.getOrNull()
  private fun decode(value: Any?, depth: Int): Any? {
    require(depth <= 20)
    return when (value) {
      JSONObject.NULL, null -> null
      is JSONObject -> value.keys().asSequence().associateWith { decode(value.get(it), depth + 1) }
      is JSONArray -> (0 until value.length()).map { decode(value.get(it), depth + 1) }
      else -> value
    }
  }
  fun clear() { file.delete() }
  companion object { private const val MAX_BYTES = 2_000_000 }
}
