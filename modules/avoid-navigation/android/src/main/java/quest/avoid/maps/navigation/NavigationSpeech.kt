package quest.avoid.maps.navigation

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/** Uses only an installed Italian voice explicitly declaring no network requirement. */
internal class NavigationSpeech(context: Context, private val changed: (String) -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
  private var closed = false
  private var ready = false
  private var muted = false
  private var tts: TextToSpeech? = null
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) handler.post { flush() }
  }
  private val focusRequest = if (Build.VERSION.SDK_INT >= 26) AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    .setAudioAttributes(attributes).setOnAudioFocusChangeListener(focusListener, handler).build() else null

  init {
    changed("initializing")
    try {
      tts = TextToSpeech(context.applicationContext) { status -> handler.post {
        if (closed) return@post
        val engine = tts
        val voice = if (status == TextToSpeech.SUCCESS) runCatching {
          engine?.voices?.filter { it.locale.language == Locale.ITALIAN.language && !it.isNetworkConnectionRequired }
            ?.sortedByDescending { it.quality }?.firstOrNull()
        }.getOrNull() else null
        ready = voice != null && runCatching { engine?.setVoice(voice) == TextToSpeech.SUCCESS }.getOrDefault(false)
        if (ready) {
          engine?.setAudioAttributes(attributes)
          engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) { handler.post { releaseFocus() } }
            @Deprecated("Legacy Android callback")
            override fun onError(utteranceId: String?) { handler.post { failed() } }
            @Deprecated("Android TTS error callback")
            override fun onError(utteranceId: String?, errorCode: Int) { handler.post { failed() } }
          })
        }
        changed(if (muted) "muted" else if (ready) "ready" else "unavailable")
      } }
    } catch (_: Exception) { changed("unavailable") }
  }
  fun mute(value: Boolean) { muted = value; if (value) flush(); changed(if (value) "muted" else if (ready) "ready" else "unavailable") }
  fun speak(text: String, id: String): Boolean {
    if (closed || muted || !ready) return false
    val granted = if (Build.VERSION.SDK_INT >= 26) audio.requestAudioFocus(focusRequest!!) else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
    if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return false
    if (tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) { failed(); return false }
    return true
  }
  fun flush() { tts?.stop(); releaseFocus() }
  private fun failed() { if (!closed) { ready = false; flush(); changed("unavailable") } }
  private fun releaseFocus() {
    if (Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(focusRequest!!) else {
      @Suppress("DEPRECATION")
      audio.abandonAudioFocus(focusListener)
    }
  }
  fun close() { closed = true; flush(); tts?.shutdown(); tts = null }
}
