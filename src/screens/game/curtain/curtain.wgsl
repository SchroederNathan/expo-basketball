// One sheet of fabric spans the whole canvas. Color never changes its shape.
struct Uniforms {
    time: f32,
    width: f32,
    height: f32,
    from_top: f32,
    point_width: f32,
    away: vec4<f32>,
    home: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var leather: texture_2d<f32>;
@group(0) @binding(2) var leather_sampler: sampler;
const LEATHER_POINTS: f32 = 80.0;

struct Vertex {
    @builtin(position) position: vec4<f32>,
    @location(0) slope: vec2<f32>,
    @location(1) material: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Vertex {
    // Matches the cached index grid in lib.rs. Fold math runs at ~16k mesh
    // vertices, rather than at every one of the phone's ~2.5m pixels.
    let uv = vec2<f32>(f32(i % 97u) / 96.0, f32(i / 97u) / 164.0);
    let p = vec2<f32>(uv.x, uv.y * u.height / u.width);
    let step = 1.0 / u.width;
    let height = cloth(p);
    let slope = vec2<f32>(cloth(p + vec2<f32>(step, 0.0)) - height,
        cloth(p + vec2<f32>(0.0, step)) - height) * u.width * 0.32;
    var vertex: Vertex;
    vertex.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    vertex.slope = slope;
    // Project the material through the SAME animated height field as the
    // folds. Interpolation stretches/compresses the grain with each ridge,
    // rather than sliding an independent screen-space noise layer over it.
    // A tile is 80 logical points, so pebble size is independent of DPR.
    vertex.material = (p + vec2<f32>(0.038, 0.09) * height) * u.point_width / LEATHER_POINTS;
    return vertex;
}

// A curved fold with soft ends. Each has its own width, reach, and wind phase;
// narrow creases can die out midway while broad billows cross the whole sheet.
fn fold(p: vec2<f32>, time: f32, offset: f32, width: f32,
        reach: f32, center: f32, phase: f32, amplitude: f32) -> f32 {
    let flow = p.x * 2.6 - time * 0.72;
    let bend = 0.13 * sin(flow + phase)
        + 0.035 * sin(p.x * 5.1 - time * 0.46 + phase * 1.7);
    let lift = 0.10 * sin(time * 0.43 + phase);
    // Tilt around the middle so the folds keep their existing placement.
    let ridge = offset - 0.13 - 0.44 * (p.x - 0.5) + bend + lift;
    let thickness = width * (1.0 + 0.23 * sin(p.x * 3.3 - time * 0.31 + phase));
    let across = (p.y - ridge) / thickness;
    let drift = center + 0.08 * sin(time * 0.37 + phase);
    let along = (p.x - drift) / reach;
    let ends = exp(-along * along * along * along);
    let breath = 0.86 + 0.14 * sin(time * 0.51 + phase * 1.3);
    return amplitude * exp(-0.5 * across * across) * ends * breath;
}

fn cloth(p: vec2<f32>) -> f32 {
    // A slow shared gust carries every fold across the color boundary. The
    // overlapping, unequal folds avoid parallel bands or two mirrored halves.
    let time = u.time * 0.3125;
    var height = 0.16 * sin(p.x * 2.1 + p.y * 1.8 - time * 0.48);
    height += fold(p, time, 0.55, 0.12, 1.20, 0.50, 0.4, 0.54);
    height += fold(p, time, 0.92, 0.07, 0.32, 0.72, 2.4, 0.18);
    height += fold(p, time, 1.15, 0.23, 0.90, 0.35, 4.1, 0.48);
    height += fold(p, time, 0.28, 0.08, 0.28, 0.18, 1.6, 0.23);
    height += fold(p, time, 1.58, 0.13, 0.40, 0.70, 5.8, 0.25);
    return height;
}

// Bright/silver accents keep the existing softer gain. Colors stay at the
// sides for games, or wash down from the top for one team. Contract applies
// the vertical fade in both cases.
fn beam(distance: f32, color: vec3<f32>) -> f32 {
    // Palette fades cross this range. A boolean brightness cutoff makes the
    // whole beam jump on the frame where a color passes the threshold.
    let bright = smoothstep(0.4, 0.8, dot(color, vec3<f32>(0.2126, 0.7152, 0.0722)));
    let peak = mix(0.70, 0.30, bright);
    let shoulder = mix(0.25, 0.10, bright);
    return select(mix(shoulder, 0.0, smoothstep(0.18, 0.48, distance)),
        mix(peak, shoulder, smoothstep(0.0, 0.18, distance)), distance < 0.18);
}

@fragment
fn fs(vertex: Vertex) -> @location(0) vec4<f32> {
    let uv = vertex.position.xy / vec2<f32>(u.width, u.height);
    let grain = textureSample(leather, leather_sampler, vertex.material);
    let grain_slope = (grain.rg * 2.0 - 1.0) * 0.55;
    // Transform the pebble normals with the deformed material, too. Both the
    // channels and their highlights compress/tilt as the sheet bends.
    let grain_screen_slope = vec2<f32>(dot(grain_slope, dpdx(vertex.material)),
        dot(grain_slope, dpdy(vertex.material))) * LEATHER_POINTS * u.width / u.point_width;
    let normal = normalize(vec3<f32>(-vertex.slope - grain_screen_slope, 1.0));
    let light = normalize(vec3<f32>(-0.45, -0.65, 1.0));
    let diffuse = max(dot(normal, light), 0.0);
    let shadow = (1.0 - smoothstep(0.16, 0.72, diffuse)) * 0.68;
    let sheen = pow(max(dot(normal, normalize(light + vec3<f32>(0.0, 0.0, 1.0))), 0.0), 22.0);
    // The lighting direction changes with the palette, without replacing the
    // fabric or jumping between side-lit games and top-lit team pages.
    let base = vec3<f32>(mix(0.066667, 0.039216, u.from_top));
    let left = mix(beam(uv.x + uv.y * 0.045, u.away.rgb),
        beam(uv.y * 0.55, u.away.rgb), u.from_top);
    let right = beam(1.0 - uv.x + uv.y * 0.045, u.home.rgb) * (1.0 - u.from_top);
    var color = mix(base, u.home.rgb, right);
    color = mix(color, u.away.rgb, left);
    color = mix(color, base * 0.30, shadow);
    // The neutral middle catches the same light, so a fold remains readable
    // as it crosses from one team's color into the other.
    color += vec3<f32>(0.075) * sheen * (0.65 + 0.35 * max(left, right));
    // Dark recessed channels and softly rounded pebbles keep the team tint.
    color *= mix(0.66, 1.06, grain.b);
    return vec4<f32>(color, 1.0);
}
