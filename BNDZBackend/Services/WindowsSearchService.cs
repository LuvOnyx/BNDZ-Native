using System;
using System.Collections.Generic;
using System.Data.OleDb;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Vanara.PInvoke;
using static Vanara.PInvoke.SearchApi;

namespace BNDZ.Services;

/// <summary>
/// Windows Search via Vanara SearchApi (AQS → SQL) with OLE DB execution.
/// Falls back to a hand-built LIKE query when SearchApi COM is unavailable.
/// </summary>
public sealed class WindowsSearchService
{
    private const string FallbackConnectionString =
        "Provider=Search.CollatorDSO;Extended Properties=\"Application=Windows\"";

    public bool IsAvailable()
    {
        try
        {
            using var conn = new OleDbConnection(FallbackConnectionString);
            conn.Open();
            return true;
        }
        catch
        {
            return false;
        }
    }

    public List<object> Search(string query, int limit, string? rootPath = null)
    {
        var results = new List<object>();
        if (string.IsNullOrWhiteSpace(query)) return results;
        limit = Math.Clamp(limit <= 0 ? 200 : limit, 1, 2000);

        try
        {
            if (!TrySearchViaVanara(query.Trim(), limit, rootPath, results) || results.Count == 0)
                SearchViaFallbackSql(query.Trim(), limit, rootPath, results);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WindowsSearch] {ex.Message}");
            try { SearchViaFallbackSql(query.Trim(), limit, rootPath, results); }
            catch (Exception ex2) { Debug.WriteLine($"[WindowsSearch.fallback] {ex2.Message}"); }
        }

        return results;
    }

    private static bool TrySearchViaVanara(string query, int limit, string? rootPath, List<object> results)
    {
        object? managerObj = null;
        try
        {
            managerObj = Activator.CreateInstance(Type.GetTypeFromCLSID(typeof(CSearchManager).GUID)!);
            if (managerObj is not ISearchManager manager) return false;

            var catalog = manager.GetCatalog("SystemIndex");
            var helper = catalog.GetQueryHelper();
            helper.QueryMaxResults = limit;
            helper.QuerySelectColumns = "System.ItemPathDisplay";
            helper.QuerySorting = "System.DateModified DESC";

            if (!string.IsNullOrWhiteSpace(rootPath))
            {
                var root = rootPath.Replace('\\', '/').TrimEnd('/');
                helper.QueryWhereRestrictions = $"AND SCOPE='file:{root}'";
            }

            var sql = helper.GenerateSQLFromUserQuery(query);
            var connStr = helper.ConnectionString;
            if (string.IsNullOrWhiteSpace(sql) || string.IsNullOrWhiteSpace(connStr))
                return false;

            ExecuteSql(connStr, sql, limit, results);
            return results.Count > 0;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WindowsSearch.Vanara] {ex.Message}");
            return false;
        }
        finally
        {
            if (managerObj != null && Marshal.IsComObject(managerObj))
                Marshal.ReleaseComObject(managerObj);
        }
    }

    private static void SearchViaFallbackSql(string query, int limit, string? rootPath, List<object> results)
    {
        var q = query.Replace("'", "''");
        var like = q.Contains('*') || q.Contains('?')
            ? q.Replace('*', '%').Replace('?', '_')
            : $"%{q}%";

        var sql = $"SELECT TOP {limit} System.ItemPathDisplay FROM SystemIndex WHERE " +
                  $"(System.FileName LIKE '{like}'";
        if (!q.Contains('%') && !q.Contains('_') && q.Length >= 2)
            sql += $" OR CONTAINS(*,'\"{q.Replace("\"", "")}*\"')";
        sql += ")";

        if (!string.IsNullOrWhiteSpace(rootPath))
        {
            var root = rootPath.Replace('/', '\\').TrimEnd('\\').Replace("'", "''");
            sql += $" AND SCOPE='file:{root.Replace("\\", "/")}'";
        }

        sql += " ORDER BY System.DateModified DESC";
        ExecuteSql(FallbackConnectionString, sql, limit, results);
    }

    private static void ExecuteSql(string connectionString, string sql, int limit, List<object> results)
    {
        using var conn = new OleDbConnection(connectionString);
        conn.Open();
        using var cmd = new OleDbCommand(sql, conn) { CommandTimeout = 8 };
        using var reader = cmd.ExecuteReader();
        while (reader.Read() && results.Count < limit)
        {
            string? path = null;
            try { path = reader[0]?.ToString(); } catch { }
            if (string.IsNullOrWhiteSpace(path)) continue;
            path = NormalizeIndexedPath(path);
            if (string.IsNullOrEmpty(path)) continue;

            var name = Path.GetFileName(path.TrimEnd('\\'));
            var isDir = Directory.Exists(path);
            long size = 0;
            try { if (!isDir && File.Exists(path)) size = new FileInfo(path).Length; } catch { }

            results.Add(new
            {
                name = string.IsNullOrEmpty(name) ? path : name,
                path,
                isDirectory = isDir,
                size,
                extension = isDir ? "" : Path.GetExtension(path),
            });
        }
    }

    private static string NormalizeIndexedPath(string path)
    {
        path = path.Replace('/', '\\');
        if (path.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            path = path["file:".Length..].TrimStart('/');
        if (path.StartsWith("///"))
            path = path.TrimStart('/');
        if (path.Length >= 2 && path[1] == ':') return path;
        if (path.StartsWith("\\\\")) return path;
        return "";
    }
}
