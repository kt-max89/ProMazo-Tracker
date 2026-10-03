#!/bin/bash
set -e

npm install
npm run db:user-access
npm run db:team-workspaces
npm run db:sprint-plans
