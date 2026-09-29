// Stub engine #2: provider/key style failure — stderr + non-zero exit.
process.stderr.write("AuthError: no credentials configured for provider openai\n")
process.exit(1)
