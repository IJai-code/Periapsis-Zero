class_name SignalSource
extends Node3D
## One signal in the Reach: heard where it is (close by), and through the
## signalscope from anywhere. Songs are kept in step with the loop's clock.

var id := ""
var title := ""
var freq := 0
var near := 18.0
var stream: AudioStream
var _here: AudioStreamPlayer3D
var _scope: AudioStreamPlayer

func _ready() -> void:
	_here = AudioStreamPlayer3D.new()
	_here.stream = stream
	_here.unit_size = near * 0.35
	_here.max_distance = near * 5.0
	_here.volume_db = -6.0 + Flow.music_db()
	_here.attenuation_filter_cutoff_hz = 9000.0
	add_child(_here)
	_scope = AudioStreamPlayer.new()
	_scope.stream = stream
	_scope.volume_db = -80.0
	add_child(_scope)

## Start playing at the song's place for loop time `t`.
func sync_to(t: float) -> void:
	if not is_inside_tree():
		await ready
	var len := stream.get_length() if stream else 1.0
	var at := fmod(t, maxf(len, 0.01))
	_here.play(at)
	_scope.play(at)

func scope_level(k: float) -> void:
	_scope.volume_db = linear_to_db(maxf(k, 0.0001)) - 2.0 + Flow.music_db() if k > 0.002 else -80.0

static var _known: Array = []
static var _loaded := false

static func _ids() -> Array:
	if not _loaded:
		var ids = Flow.progress("reach_signals", [])
		_known = ids if ids is Array else []
		_loaded = true
	return _known

func identified() -> bool:
	return id in _ids()

func identify() -> void:
	if not id in _ids():
		_known.append(id)
		Flow.set_progress("reach_signals", _known)
