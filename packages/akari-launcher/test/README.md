# Playbook kit install reproduction

Run `node --test packages/akari-launcher/test/playbook-kit-install.test.mjs` from the repository root. The test builds a one-playbook kit and zip in a temporary directory, starts the real `akari store install <id> --from-file <zip>` CLI with `AKARI_HOME` set to a temporary home, then checks the relative symlink, installed ledger, uninstall, and an occupied local directory. It also checks that a free product downloads through the public assets URL without credentials. All generated files are removed at the end of the test.
