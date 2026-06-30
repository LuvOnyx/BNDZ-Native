using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

/// <summary>XYplorer-style boolean filename query: AND (space), OR, NOT, quotes.</summary>
public static class BndzBooleanSearchParser
{
    public sealed class Node
    {
        public string? Term { get; init; }
        public string Op { get; init; } = "TERM"; // TERM | AND | OR | NOT
        public List<Node> Children { get; init; } = [];
    }

    public static Node Parse(string query)
    {
        var tokens = Tokenize(query ?? "");
        if (tokens.Count == 0) return new Node { Op = "TERM", Term = "" };
        var idx = 0;
        return ParseOr(tokens, ref idx);
    }

    public static string ToEverythingQuery(Node node)
    {
        if (node.Op == "TERM") return Escape(node.Term ?? "");
        if (node.Op == "NOT" && node.Children.Count == 1)
            return $"!{ToEverythingQuery(node.Children[0])}";
        if (node.Op == "AND")
            return string.Join(" ", node.Children.Select(ToEverythingQuery));
        if (node.Op == "OR")
            return string.Join("|", node.Children.Select(ToEverythingQuery));
        return "";
    }

    public static bool MatchesFilename(string name, Node node, bool useRegex)
    {
        if (node.Op == "TERM")
        {
            var term = node.Term ?? "";
            if (string.IsNullOrEmpty(term)) return true;
            if (useRegex)
            {
                try { return Regex.IsMatch(name, term, RegexOptions.IgnoreCase); }
                catch { return name.Contains(term, StringComparison.OrdinalIgnoreCase); }
            }
            return name.Contains(term, StringComparison.OrdinalIgnoreCase);
        }
        if (node.Op == "NOT" && node.Children.Count == 1)
            return !MatchesFilename(name, node.Children[0], useRegex);
        if (node.Op == "AND")
            return node.Children.All(c => MatchesFilename(name, c, useRegex));
        if (node.Op == "OR")
            return node.Children.Any(c => MatchesFilename(name, c, useRegex));
        return true;
    }

    private static string Escape(string s) => s.Contains(' ') ? $"\"{s.Replace("\"", "\\\"")}\"" : s;

    private static List<string> Tokenize(string q)
    {
        var tokens = new List<string>();
        var i = 0;
        while (i < q.Length)
        {
            if (char.IsWhiteSpace(q[i])) { i++; continue; }
            if (q[i] == '"')
            {
                var end = q.IndexOf('"', i + 1);
                if (end < 0) { tokens.Add(q[(i + 1)..].Trim()); break; }
                tokens.Add(q.Substring(i + 1, end - i - 1));
                i = end + 1;
                continue;
            }
            var start = i;
            while (i < q.Length && !char.IsWhiteSpace(q[i])) i++;
            tokens.Add(q[start..i]);
        }
        return tokens;
    }

    private static Node ParseOr(List<string> tokens, ref int idx)
    {
        var left = ParseAnd(tokens, ref idx);
        var children = new List<Node> { left };
        while (idx < tokens.Count && tokens[idx].Equals("OR", StringComparison.OrdinalIgnoreCase))
        {
            idx++;
            children.Add(ParseAnd(tokens, ref idx));
        }
        return children.Count == 1 ? left : new Node { Op = "OR", Children = children };
    }

    private static Node ParseAnd(List<string> tokens, ref int idx)
    {
        var parts = new List<Node>();
        while (idx < tokens.Count)
        {
            if (tokens[idx].Equals("OR", StringComparison.OrdinalIgnoreCase)) break;
            if (tokens[idx].Equals("AND", StringComparison.OrdinalIgnoreCase)) { idx++; continue; }
            if (tokens[idx].Equals("NOT", StringComparison.OrdinalIgnoreCase))
            {
                idx++;
                if (idx >= tokens.Count) break;
                parts.Add(new Node { Op = "NOT", Children = [ParseTerm(tokens, ref idx)] });
                continue;
            }
            parts.Add(ParseTerm(tokens, ref idx));
        }
        if (parts.Count == 0) return new Node { Op = "TERM", Term = "" };
        if (parts.Count == 1) return parts[0];
        return new Node { Op = "AND", Children = parts };
    }

    private static Node ParseTerm(List<string> tokens, ref int idx)
    {
        if (idx >= tokens.Count) return new Node { Op = "TERM", Term = "" };
        return new Node { Op = "TERM", Term = tokens[idx++] };
    }
}
