#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_action() {
    echo -e "${PURPLE}🔄${NC} $1"
}

if [ ! -d ".git" ]; then
    print_error "This script must be run from the root of a Git repository"
    exit 1
fi

print_info "🚀 Installing Git hooks..."
echo

mkdir -p .git/hooks

hooks=("pre-commit" "pre-push" "post-merge" "post-checkout" "commit-msg")

for hook in "${hooks[@]}"; do
    source_hook=".githooks/$hook"
    target_hook=".git/hooks/$hook"

    if [ -f "$source_hook" ]; then
        if [ -f "$target_hook" ] || [ -L "$target_hook" ]; then
            rm "$target_hook"
            print_info "Removed existing $hook hook"
        fi

        if ln -s "../../$source_hook" "$target_hook"; then
            print_success "Installed $hook hook"
        else
            print_error "Failed to install $hook hook"
            exit 1
        fi
    else
        print_warning "Hook file $source_hook not found"
    fi
done

echo

print_action "Making hook files executable..."
chmod +x .githooks/*

print_success "✅ All hooks installed successfully!"
echo

print_info "📋 Installed hooks:"
for hook in "${hooks[@]}"; do
    echo "  • $hook"
done

echo
print_info "🎯 Hook capabilities:"
echo "  • pre-commit: Ruff lint, unit tests"
echo "  • pre-push: Branch name convention check (warning)"
echo "  • post-merge: Auto-install dependencies if pyproject.toml changed"
echo "  • post-checkout: Auto-install dependencies when switching branches"
echo "  • commit-msg: Validates commit message format and length"

echo
print_success "🎉 Git hooks setup complete!"
