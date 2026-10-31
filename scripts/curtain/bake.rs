mod leather;

fn main() {
    assert_eq!(leather::MIPS, 9);
    let path = std::env::args().nth(1).expect("output path");
    std::fs::write(path, leather::bake()).unwrap();
}
