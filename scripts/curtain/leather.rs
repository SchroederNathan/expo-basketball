//! Bake a seamless basketball pebble normal/height map. This runs at build
//! time; a frame only samples the uploaded, mipmapped tile.
pub const SIZE: u32 = 256;
pub const MIPS: u32 = SIZE.ilog2() + 1;
const CELLS: i32 = 16;
const PERIOD: f32 = CELLS as f32;

fn hash(mut h: u32) -> f32 {
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    ((h ^ (h >> 16)) >> 8) as f32 / 16_777_216.0
}

fn delta(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    std::array::from_fn(|i| {
        let d = a[i] - b[i];
        if d > PERIOD * 0.5 {
            d - PERIOD
        } else if d < -PERIOD * 0.5 {
            d + PERIOD
        } else {
            d
        }
    })
}

fn length_squared(p: [f32; 2]) -> f32 {
    p[0] * p[0] + p[1] * p[1]
}

fn smooth_min(a: f32, b: f32) -> f32 {
    let h = (0.5 + 0.5 * (b - a) / 0.10).clamp(0.0, 1.0);
    b + (a - b) * h - 0.10 * h * (1.0 - h)
}

struct Pebble {
    center: [f32; 2],
    radius: f32,
    aspect: f32,
    rotation: [f32; 2],
    variation: f32,
    neighbors: Vec<([f32; 2], f32)>,
}

struct Leather {
    pebbles: Vec<Pebble>,
    bins: Vec<Vec<usize>>,
}

impl Leather {
    fn new() -> Self {
        let mut pebbles: Vec<Pebble> = Vec::new();
        // Dart throwing on a torus: no rows, stagger, or underlying lattice.
        // Keep the random packing rather than relaxing it toward hexagons.
        for attempt in 0u32..25_000 {
            let random = |salt| hash(attempt.wrapping_mul(747_796_405) ^ salt);
            let center = [random(17) * PERIOD, random(59) * PERIOD];
            if pebbles
                .iter()
                .any(|p| length_squared(delta(center, p.center)) < 0.72 * 0.72)
            {
                continue;
            }
            let angle = random(211) * std::f32::consts::TAU;
            pebbles.push(Pebble {
                center,
                radius: 0.49 + 0.20 * random(113),
                aspect: 0.82 + 0.36 * random(173),
                rotation: [angle.cos(), angle.sin()],
                variation: random(283),
                neighbors: Vec::new(),
            });
            if pebbles.len() == 320 {
                break;
            }
        }
        let centers: Vec<_> = pebbles.iter().map(|p| p.center).collect();
        let mut bins = vec![Vec::new(); (CELLS * CELLS) as usize];
        for (i, pebble) in pebbles.iter_mut().enumerate() {
            bins[(pebble.center[1] as i32 * CELLS + pebble.center[0] as i32) as usize].push(i);
            for (j, center) in centers.iter().enumerate() {
                let d = delta(*center, pebble.center);
                let distance = length_squared(d).sqrt();
                if i != j && distance < 2.5 {
                    pebble
                        .neighbors
                        .push(([d[0] / distance, d[1] / distance], distance));
                }
            }
        }
        Self { pebbles, bins }
    }

    fn height(&self, x: u32, y: u32) -> f32 {
        let p = [
            (x as f32 + 0.5) * PERIOD / SIZE as f32,
            (y as f32 + 0.5) * PERIOD / SIZE as f32,
        ];
        let cell = [p[0] as i32, p[1] as i32];
        let mut nearest = (f32::MAX, 0, [0.0; 2]);
        for dy in -2..=2 {
            for dx in -2..=2 {
                let bin =
                    (cell[1] + dy).rem_euclid(CELLS) * CELLS + (cell[0] + dx).rem_euclid(CELLS);
                for &i in &self.bins[bin as usize] {
                    let d = delta(p, self.pebbles[i].center);
                    let distance = length_squared(d);
                    if distance < nearest.0 {
                        nearest = (distance, i, d)
                    }
                }
            }
        }
        let (_, index, d) = nearest;
        let pebble = &self.pebbles[index];
        // Smoothly inset each random cell's corners, then round its outer
        // contour. These become unequal leather pebbles, not polygon outlines.
        let mut edge: f32 = 1.0;
        for (normal, distance) in &pebble.neighbors {
            edge = smooth_min(edge, distance * 0.5 - d[0] * normal[0] - d[1] * normal[1]);
        }
        let [c, s] = pebble.rotation;
        let q = [
            (d[0] * c + d[1] * s) / pebble.radius,
            (-d[0] * s + d[1] * c) / (pebble.radius * pebble.aspect),
        ];
        let radial = length_squared(q).sqrt();
        edge = smooth_min(edge, (1.0 - radial) * pebble.radius);
        let rim = ((edge - 0.012) / 0.12).clamp(0.0, 1.0);
        let dome = (1.0 - radial).clamp(0.0, 1.0);
        let pores = hash(x.wrapping_mul(374_761_393) ^ y.wrapping_mul(668_265_263));
        rim * rim
            * (3.0 - 2.0 * rim)
            * (0.72 + 0.14 * dome + 0.11 * pebble.variation + 0.03 * pores)
    }
}

pub fn bake() -> Vec<u8> {
    let leather = Leather::new();
    let heights: Vec<f32> = (0..SIZE * SIZE)
        .map(|i| leather.height(i % SIZE, i / SIZE))
        .collect();
    let at = |x: i32, y: i32| {
        heights
            [(y.rem_euclid(SIZE as i32) as u32 * SIZE + x.rem_euclid(SIZE as i32) as u32) as usize]
    };
    let encode = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    let mut pixels = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE as i32 {
        for x in 0..SIZE as i32 {
            pixels.extend_from_slice(&[
                encode(0.5 + (at(x + 1, y) - at(x - 1, y)) * 0.8),
                encode(0.5 + (at(x, y + 1) - at(x, y - 1)) * 0.8),
                encode(at(x, y)),
                255,
            ]);
        }
    }
    let mut all = pixels.clone();
    let mut size = SIZE as usize;
    while size > 1 {
        let half = size / 2;
        let mut next = vec![0; half * half * 4];
        for y in 0..half {
            for x in 0..half {
                for c in 0..4 {
                    let sum: u32 = [(0, 0), (1, 0), (0, 1), (1, 1)]
                        .iter()
                        .map(|(dx, dy)| {
                            u32::from(pixels[((y * 2 + dy) * size + x * 2 + dx) * 4 + c])
                        })
                        .sum();
                    next[(y * half + x) * 4 + c] = ((sum + 2) / 4) as u8;
                }
            }
        }
        all.extend_from_slice(&next);
        pixels = next;
        size = half;
    }
    all
}
