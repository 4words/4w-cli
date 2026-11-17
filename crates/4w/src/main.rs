#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(error) = fw_cli::app::run(args).await {
        eprintln!("4w: {error}");
        std::process::exit(1);
    }
}
