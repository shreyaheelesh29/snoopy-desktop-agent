$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$listener = $null

try {
  Add-Type -AssemblyName System.Speech
  $recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $recognizerInfo = $recognizers | Where-Object { $_.Culture.Name -eq 'en-IN' } | Select-Object -First 1
  if (-not $recognizerInfo) { $recognizerInfo = $recognizers | Where-Object { $_.Culture.Name -eq 'en-GB' } | Select-Object -First 1 }
  if (-not $recognizerInfo) { $recognizerInfo = $recognizers | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1 }
  if (-not $recognizerInfo) {
    throw 'Windows has no compatible English speech recognizer installed. Install English speech recognition in Language & region settings.'
  }
  $cultureName = $recognizerInfo.Culture.Name

  $source = @'
using System;
using System.Globalization;
using System.Speech.Recognition;

public sealed class SnoopyNativeSpeechListener : IDisposable
{
    private readonly SpeechRecognitionEngine engine;
    private readonly object outputLock = new object();
    private DateTime lastLevelEvent = DateTime.MinValue;
    private int lastAudioLevel = -1;

    public SnoopyNativeSpeechListener(string cultureName)
    {
        engine = new SpeechRecognitionEngine(new CultureInfo(cultureName));
        engine.InitialSilenceTimeout = TimeSpan.FromSeconds(5);
        engine.EndSilenceTimeout = TimeSpan.FromSeconds(0.8);
        engine.LoadGrammar(new DictationGrammar());
        engine.SetInputToDefaultAudioDevice();
        engine.SpeechDetected += OnSpeechDetected;
        engine.SpeechHypothesized += OnSpeechHypothesized;
        engine.SpeechRecognized += OnSpeechRecognized;
        engine.SpeechRecognitionRejected += OnSpeechRejected;
        engine.AudioLevelUpdated += OnAudioLevelUpdated;
    }

    public void Start()
    {
        engine.RecognizeAsync(RecognizeMode.Multiple);
    }

    private void OnSpeechDetected(object sender, SpeechDetectedEventArgs e)
    {
        Emit("__SNOOPY_SPEECH__");
    }

    private void OnSpeechHypothesized(object sender, SpeechHypothesizedEventArgs e)
    {
        if (e.Result != null && !String.IsNullOrWhiteSpace(e.Result.Text))
            Emit("__SNOOPY_PARTIAL__" + e.Result.Text);
    }

    private void OnSpeechRecognized(object sender, SpeechRecognizedEventArgs e)
    {
        if (e.Result != null && !String.IsNullOrWhiteSpace(e.Result.Text))
            Emit("__SNOOPY_FINAL__" + e.Result.Text);
    }

    private void OnSpeechRejected(object sender, SpeechRecognitionRejectedEventArgs e)
    {
        if (e.Result != null && !String.IsNullOrWhiteSpace(e.Result.Text))
            Emit("__SNOOPY_PARTIAL__" + e.Result.Text);
    }

    private void OnAudioLevelUpdated(object sender, AudioLevelUpdatedEventArgs e)
    {
        DateTime now = DateTime.UtcNow;
        if ((now - lastLevelEvent).TotalMilliseconds < 200) return;
        lastLevelEvent = now;
        if (e.AudioLevel == lastAudioLevel) return;
        lastAudioLevel = e.AudioLevel;
        Emit("__SNOOPY_LEVEL__" + e.AudioLevel);
    }

    private void Emit(string line)
    {
        lock (outputLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    public int AudioLevel { get { return engine.AudioLevel; } }

    public void Dispose()
    {
        engine.SpeechDetected -= OnSpeechDetected;
        engine.SpeechHypothesized -= OnSpeechHypothesized;
        engine.SpeechRecognized -= OnSpeechRecognized;
        engine.SpeechRecognitionRejected -= OnSpeechRejected;
        engine.AudioLevelUpdated -= OnAudioLevelUpdated;
        engine.Dispose();
    }
}
'@

  $speechAssembly = [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location
  Add-Type -TypeDefinition $source -ReferencedAssemblies @($speechAssembly)
  $listener = [SnoopyNativeSpeechListener]::new($cultureName)
  $listener.Start()
  [Console]::Out.WriteLine('__SNOOPY_READY__')
  [Console]::Out.WriteLine('__SNOOPY_LANGUAGE__' + $cultureName)
  [Console]::Out.Flush()
  $lastLevel = -1
  while ($true) {
    $level = [int]$listener.AudioLevel
    if ($level -ne $lastLevel) {
      [Console]::Out.WriteLine('__SNOOPY_LEVEL__' + $level)
      [Console]::Out.Flush()
      $lastLevel = $level
    }
    Start-Sleep -Milliseconds 200
  }
} catch {
  $message = $_.Exception.Message -replace '[\r\n]+', ' '
  [Console]::Out.WriteLine('__SNOOPY_ERROR__' + $message)
  [Console]::Out.Flush()
  exit 1
} finally {
  if ($listener) { $listener.Dispose() }
}
