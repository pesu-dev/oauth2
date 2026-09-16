#!/bin/bash

# Colors for output
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

# Check branch naming convention
check_branch_name() {
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD)
    local branch_regex="^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_-]+$|^(main)$"

    print_action "Checking branch name: $branch"

    if [[ $branch =~ $branch_regex ]]; then
        print_success "Branch name follows convention"
        return 0
    fi

    print_warning "Branch name '$branch' doesn't follow convention ((github-username)/feature-description)"
    print_info "Expected format: (github-username)/feature-description or main"
    return 0
}

# Run lint and format checks
run_quality_checks() {
    print_action "Running quality checks..."

    if [ -f "$REPO_ROOT/package.json" ]; then
        if grep -q '"lint"' "$REPO_ROOT/package.json"; then
            print_info "Running pnpm lint..."
            if ! pnpm lint; then
                print_error "pnpm lint failed"
                return 1
            fi
            print_success "pnpm lint passed"
        fi
        return 0
    else
        print_info "No package.json in root; skipping lint."
        return 0
    fi
}

run_unit_tests() {
    print_action "Running unit tests..."

    if [ -f "$REPO_ROOT/package.json" ]; then
        if grep -q '"test:unit"' "$REPO_ROOT/package.json"; then
            print_info "Running pnpm test:unit..."
            if ! pnpm test:unit; then
                print_error "pnpm test:unit failed"
                return 1
            fi
            print_success "pnpm test:unit passed"
        fi
        return 0
    else
        print_info "No package.json in root; skipping tests."
        return 0
    fi
}

# Install dependencies using pnpm
maybe_install_packages() {
    if pnpm install --frozen-lockfile; then
        print_success "Dependencies installed successfully"
    else
        print_error "Failed to install dependencies"
        print_info "Try: pnpm install"
        return 1
    fi
    return 0
}

# Validate commit message
validate_commit_message() {
    local commit_msg="$1"
    local commit_regex='^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert): .{1,50}'

    print_action "Validating commit message..."

    if [ ${#commit_msg} -lt 10 ]; then
        print_error "Commit message must be at least 10 characters long"
        return 1
    fi

    if [[ ! $commit_msg =~ $commit_regex ]]; then
        print_warning "Commit message doesn't follow conventional format"
        print_info "Expected: 'type: description' where type is one of:"
        print_info "feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert"
        print_info "Example: 'feat: add authorization code endpoint'"
    else
        print_success "Commit message follows conventional format"
    fi

    return 0
}
