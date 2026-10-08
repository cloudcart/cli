#!/usr/bin/env -S node --no-warnings --

// `--` ends Node's own options. Without it Node also reads `--env-file <path>` meant for a command
// (`nitrogen env pull --env-file .env.local`) and exits when that file does not exist yet.

import { execute } from '@oclif/core';

await execute({ dir: import.meta.url });
