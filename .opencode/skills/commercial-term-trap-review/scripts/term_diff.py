#!/usr/bin/env python3
import argparse
import difflib
import re
import sys

TOKENS = [
    "含税", "不含税", "含增值税", "增值税", "额外", "另加", "租金", "物业费",
    "物业管理费", "服务费", "保证金", "免租", "装修期", "暂定", "可调整",
    "提前终止", "复原", "现状交付", "营业额", "净营业额", "扣率", "保底",
    "VAT", "tax", "inclusive", "exclusive", "deposit", "rent", "service fee",
]

PATTERNS = {
    "percent": re.compile(r"\d+(?:\.\d+)?\s*%"),
    "money": re.compile(r"(?:RMB|CNY|¥|￥)\s*\d[\d,]*(?:\.\d+)?"),
    "date": re.compile(r"\d{4}[-/年]\d{1,2}[-/月]\d{1,2}"),
}


def normalize(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return [line for line in lines if line]


def compact(text):
    return re.sub(r"\s+", "", text)


def token_hits(lines):
    found = {}
    for line in lines:
        lowered = line.lower()
        for token in TOKENS:
            if token.lower() in lowered:
                found.setdefault(token, []).append(line)
    return found


def values(lines):
    joined = "\n".join(lines)
    return {name: sorted(set(pattern.findall(joined))) for name, pattern in PATTERNS.items()}


def print_section(title):
    print()
    print(title)
    print("-" * len(title))


def main():
    parser = argparse.ArgumentParser(
        description="Diff two commercial term sheets and highlight tax, fee and version-drift tokens."
    )
    parser.add_argument("old", help="Path to the prior version")
    parser.add_argument("new", help="Path to the new version")
    parser.add_argument("--context", type=int, default=3, help="Lines of context (default: 3)")
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    with open(args.old, "r", encoding="utf-8-sig") as handle:
        old_lines = normalize(handle.read())
    with open(args.new, "r", encoding="utf-8-sig") as handle:
        new_lines = normalize(handle.read())

    print_section("Versions")
    print(f"OLD: {args.old} ({len(old_lines)} lines)")
    print(f"NEW: {args.new} ({len(new_lines)} lines)")

    print_section("Values")
    old_values = values(old_lines)
    new_values = values(new_lines)
    for name in PATTERNS:
        old_set = set(old_values[name])
        new_set = set(new_values[name])
        added = sorted(new_set - old_set)
        removed = sorted(old_set - new_set)
        print(f"{name}: old={sorted(old_set)} new={sorted(new_set)}")
        if removed:
            print(f"  removed: {removed}")
        if added:
            print(f"  added: {added}")

    print_section("Commercial tokens")
    old_tokens = token_hits(old_lines)
    new_tokens = token_hits(new_lines)
    added_tokens = sorted(set(new_tokens) - set(old_tokens))
    removed_tokens = sorted(set(old_tokens) - set(new_tokens))
    print(f"removed tokens: {removed_tokens or 'none'}")
    print(f"added tokens: {added_tokens or 'none'}")
    for token in sorted(set(old_tokens) & set(new_tokens)):
        if old_tokens[token] != new_tokens[token]:
            print(f"changed context: {token}")

    print_section("Word-level changes")
    old_text = compact("\n".join(old_lines))
    new_text = compact("\n".join(new_lines))
    matcher = difflib.SequenceMatcher(None, old_text, new_text, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        old_part = old_text[i1:i2]
        new_part = new_text[j1:j2]
        print(f"{tag}: OLD=[{old_part}] -> NEW=[{new_part}]")

    print_section("Line diff")
    diff = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=args.old,
        tofile=args.new,
        n=args.context,
        lineterm="",
    )
    for line in diff:
        marker = ""
        if line.startswith("+") and not line.startswith("+++"):
            marker = " <-- ADDED"
        elif line.startswith("-") and not line.startswith("---"):
            marker = " <-- REMOVED"
        print(line + marker)

    print_section("Next step")
    print("Read every changed line in full context. Build the tax matrix before replying.")


if __name__ == "__main__":
    main()
