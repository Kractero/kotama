{pkgs ? import <nixpkgs> {}}:
pkgs.mkShell
{
  nativeBuildInputs = with pkgs; [
    nodejs
    npm-check-updates
    redis
  ];

  shellHook = ''
    redis-server --daemonize yes
  '';
}
