#!/bin/bash

# Quick setup script for Koyeb deployment
# This validates your configuration before deploying

echo "🔍 Validating Koyeb deployment configuration..."
echo ""

# Check for required files
echo "Checking required files..."
required_files=(
  ".koyeb/app.yaml"
  "KOYEB_DEPLOYMENT.md"
  "backend/package.json"
  "backend/src/server.js"
  "backend/src/db/schema.sql"
  "backend/src/db/migrate.js"
  "backend/src/db/client.js"
)

missing_files=0
for file in "${required_files[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ Missing: $file"
    missing_files=$((missing_files + 1))
  fi
done

echo ""

# Check backend/.env exists
if [ -f "backend/.env" ]; then
  echo "✅ backend/.env exists"
  echo ""
  echo "⚠️  Remember: .env is for LOCAL development only"
  echo "   Set environment variables in the Koyeb dashboard for production"
else
  echo "⚠️  backend/.env not found (optional for local development)"
fi

echo ""

# Check if SQLite is configured
if grep -q "DATABASE_URL=sqlite:" backend/.env 2>/dev/null; then
  echo "✅ SQLite configured in .env"
else
  echo "⚠️  SQLite not found in .env (should be: DATABASE_URL=sqlite:./data/portal.db)"
fi

echo ""

if [ $missing_files -eq 0 ]; then
  echo "✅ All required files present!"
  echo ""
  echo "📋 Next steps:"
  echo "1. Commit your changes:"
  echo "   git add ."
  echo "   git commit -m 'Configure for Koyeb deployment'"
  echo "   git push origin main"
  echo ""
  echo "2. Deploy on Koyeb:"
  echo "   - Go to https://app.koyeb.com"
  echo "   - Create new App (GitHub source)"
  echo "   - Koyeb will auto-detect .koyeb/app.yaml"
  echo "   - Add environment variables (see KOYEB_DEPLOYMENT.md)"
  echo ""
  echo "3. Read full guide: KOYEB_DEPLOYMENT.md"
else
  echo "❌ $missing_files file(s) missing. Please ensure all files are present."
  exit 1
fi
