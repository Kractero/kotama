{pkgs ? import <nixpkgs> {}}:
pkgs.mkShell
{
  nativeBuildInputs = with pkgs; [
    nodejs
    npm-check-updates
    redis
    python3
  ];

  shellHook = ''
    redis-server --daemonize yes
  '';
}
