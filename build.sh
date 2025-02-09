#!/bin/bash
# Make the script executable
chmod +x build.sh

# Install dependencies
npm install

# Build TypeScript files
npx tsc

# Create production build
npm run build