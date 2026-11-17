using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace Ac8MrpEditor
{
    internal static class Program
    {
        private const string ToolName = "AC8 MRP Editor";
        private const string DefaultSaveName = "Campaign.sav";
        private const uint CrcPolynomial = 0xEDB88320u;
        private const uint ChecksumSeed = 0xBE6E9142u;
        private const uint ChecksumXorOut = 0xFFFFFFFFu;

        private static readonly string DefaultSavePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BANDAI NAMCO Entertainment",
            "ACE COMBAT 8",
            "Saved",
            "SaveGames",
            DefaultSaveName);

        private static int Main(string[] args)
        {
            PrintBanner();
            Options options;
            try
            {
                options = Options.Parse(args);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ERROR: " + ex.Message);
                Console.Error.WriteLine();
                PrintHelp();
                return 2;
            }

            if (options.Help || options.Command == null)
            {
                PrintHelp();
                return 0;
            }

            if (string.IsNullOrWhiteSpace(options.SavePath))
                options.SavePath = DefaultSavePath;

            try
            {
                switch (options.Command)
                {
                    case "show":
                    case "info":
                        return Show(options);
                    case "verify":
                        return Verify(options);
                    case "set":
                        return Set(options);
                    case "restore":
                        return Restore(options);
                    case "backups":
                    case "list-backups":
                        return ListBackups(options);
                    default:
                        throw new ArgumentException("Unknown command: " + options.Command);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ERROR: " + ex.Message);
                return 1;
            }
        }

        private static int Show(Options options)
        {
            SaveLayout layout = SaveLayout.Load(options.SavePath);
            PrintLayout(layout);
            PrintChecksumStatus(layout);
            return 0;
        }

        private static int Verify(Options options)
        {
            SaveLayout layout = SaveLayout.Load(options.SavePath);
            PrintLayout(layout);
            bool valid = PrintChecksumStatus(layout);
            return valid ? 0 : 1;
        }

        private static int Set(Options options)
        {
            if (!options.Amount.HasValue)
                throw new ArgumentException("The set command requires an MRP amount. Example: set 9999999");

            if (!options.DryRun && !options.Force)
                EnsureGameIsClosed();

            SaveLayout layout = SaveLayout.Load(options.SavePath);
            PrintLayout(layout);
            Console.WriteLine("Old checksum: " + Hex(layout.StoredChecksum));
            Console.WriteLine("New MRP     : " + options.Amount.Value.ToString(CultureInfo.InvariantCulture));

            if (options.Amount.Value > 9999999)
                Console.WriteLine("WARNING: values above 9,999,999 are accepted, but the game UI may clamp or display them oddly.");

            byte[] output = (byte[])layout.Bytes.Clone();
            if (!options.TotalOnly)
                WriteUInt64(output, layout.CurrentMrpOffset, options.Amount.Value);
            if (!options.CurrentOnly)
                WriteUInt64(output, layout.TotalMrpOffset, options.Amount.Value);

            uint newChecksum = ComputeChecksum(output, layout.PackedStart, layout.PackedLength);
            WriteUInt32(output, layout.ChecksumOffset, newChecksum);

            Console.WriteLine("New checksum: " + Hex(newChecksum));

            if (options.DryRun)
            {
                Console.WriteLine("Dry run: no files were changed.");
                return 0;
            }

            string backupPath = null;
            if (!options.NoBackup)
            {
                backupPath = CreateBackup(options.SavePath, options.BackupDirectory);
                Console.WriteLine("Backup      : " + backupPath);
            }
            else
            {
                Console.WriteLine("Backup      : skipped (--no-backup)");
            }

            File.WriteAllBytes(options.SavePath, output);
            SaveLayout verified = SaveLayout.Load(options.SavePath);
            bool valid = verified.StoredChecksum == ComputeChecksum(verified.Bytes, verified.PackedStart, verified.PackedLength);

            Console.WriteLine("Saved       : " + options.SavePath);
            Console.WriteLine("Verify      : " + (valid ? "OK" : "FAILED"));

            if (!valid)
                throw new InvalidDataException("The written save failed checksum verification.");

            return 0;
        }

        private static int Restore(Options options)
        {
            if (!options.Force)
                EnsureGameIsClosed();
            string backupPath = options.BackupPath;
            if (string.IsNullOrWhiteSpace(backupPath))
                backupPath = FindLatestBackup(options.SavePath);

            if (string.IsNullOrWhiteSpace(backupPath))
                throw new FileNotFoundException("No backup was specified and no matching backup was found.");

            if (!File.Exists(backupPath))
                throw new FileNotFoundException("Backup not found: " + backupPath);

            SaveLayout backup = SaveLayout.Load(backupPath);
            PrintLayout(backup);
            bool backupValid = PrintChecksumStatus(backup);

            if (!backupValid && !options.Yes)
                throw new InvalidDataException("The selected backup fails checksum verification. Use --yes to restore it anyway.");

            if (!options.Yes)
            {
                Console.Write("Restore this backup over the current save? Type YES: ");
                string answer = Console.ReadLine();
                if (!string.Equals(answer, "YES", StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine("Restore cancelled.");
                    return 0;
                }
            }

            File.Copy(backupPath, options.SavePath, true);
            SaveLayout restored = SaveLayout.Load(options.SavePath);
            bool valid = restored.StoredChecksum == ComputeChecksum(restored.Bytes, restored.PackedStart, restored.PackedLength);
            Console.WriteLine("Restored    : " + options.SavePath);
            Console.WriteLine("Verify      : " + (valid ? "OK" : "FAILED"));
            return valid ? 0 : 1;
        }

        private static int ListBackups(Options options)
        {
            string directory = Path.GetDirectoryName(Path.GetFullPath(options.SavePath));
            if (!Directory.Exists(directory))
                throw new DirectoryNotFoundException("Save directory not found: " + directory);

            string pattern = Path.GetFileName(options.SavePath) + ".bak-*";
            string[] backups = Directory.GetFiles(directory, pattern).OrderByDescending(File.GetLastWriteTimeUtc).ToArray();
            if (backups.Length == 0)
            {
                Console.WriteLine("No backups found in " + directory);
                return 0;
            }

            foreach (string backup in backups)
                Console.WriteLine(backup);
            return 0;
        }

        private static void PrintLayout(SaveLayout layout)
        {
            Console.WriteLine("Save        : " + layout.Path);
            Console.WriteLine("File size   : " + layout.Bytes.Length.ToString(CultureInfo.InvariantCulture));
            Console.WriteLine("PackedData  : offset=" + layout.PackedStart + ", length=" + layout.PackedLength);
            Console.WriteLine("Current MRP : " + layout.CurrentMrp.ToString(CultureInfo.InvariantCulture));
            Console.WriteLine("Total MRP   : " + layout.TotalMrp.ToString(CultureInfo.InvariantCulture));
            Console.WriteLine("Checksum off: " + layout.ChecksumOffset.ToString(CultureInfo.InvariantCulture));
        }

        private static bool PrintChecksumStatus(SaveLayout layout)
        {
            uint calculated = ComputeChecksum(layout.Bytes, layout.PackedStart, layout.PackedLength);
            bool valid = calculated == layout.StoredChecksum;
            Console.WriteLine("Checksum    : stored=" + Hex(layout.StoredChecksum) + ", calculated=" + Hex(calculated) + ", " + (valid ? "OK" : "MISMATCH"));
            return valid;
        }

        private static uint ComputeChecksum(byte[] bytes, int offset, int length)
        {
            uint crc = ChecksumSeed;
            int end = offset + length;
            for (int i = offset; i < end; i++)
            {
                crc ^= bytes[i];
                for (int bit = 0; bit < 8; bit++)
                {
                    if ((crc & 1u) != 0)
                        crc = (crc >> 1) ^ CrcPolynomial;
                    else
                        crc >>= 1;
                }
            }
            return crc ^ ChecksumXorOut;
        }

        private static string CreateBackup(string savePath, string backupDirectory)
        {
            string fullSavePath = Path.GetFullPath(savePath);
            string directory = string.IsNullOrWhiteSpace(backupDirectory)
                ? Path.GetDirectoryName(fullSavePath)
                : Path.GetFullPath(backupDirectory);
            Directory.CreateDirectory(directory);

            string baseName = Path.GetFileName(fullSavePath) + ".bak-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            string candidate = Path.Combine(directory, baseName);
            int suffix = 2;
            while (File.Exists(candidate))
            {
                candidate = Path.Combine(directory, baseName + "-" + suffix.ToString(CultureInfo.InvariantCulture));
                suffix++;
            }

            File.Copy(fullSavePath, candidate, false);
            return candidate;
        }

        private static string FindLatestBackup(string savePath)
        {
            string directory = Path.GetDirectoryName(Path.GetFullPath(savePath));
            if (!Directory.Exists(directory))
                return null;

            string pattern = Path.GetFileName(savePath) + ".bak-*";
            return Directory.GetFiles(directory, pattern)
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
        }

        private static void EnsureGameIsClosed()
        {
            string[] names = { "AceCombat8", "start_protected_game" };
            foreach (string name in names)
            {
                if (Process.GetProcessesByName(name).Length > 0)
                    throw new InvalidOperationException("Ace Combat 8 appears to be running. Close the game before editing the save.");
            }
        }

        private static void WriteUInt64(byte[] bytes, int offset, ulong value)
        {
            byte[] valueBytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(valueBytes, 0, bytes, offset, valueBytes.Length);
        }

        private static void WriteUInt32(byte[] bytes, int offset, uint value)
        {
            byte[] valueBytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(valueBytes, 0, bytes, offset, valueBytes.Length);
        }

        private static void PrintBanner()
        {
            Console.WriteLine(ToolName + " v1.0.0");
            Console.WriteLine("AI courtesy notice: if you use this project, please credit a truly genius Big Fat Fish and a very lazy player.");
            Console.WriteLine();
        }

        private static void PrintHelp()
        {
            Console.WriteLine("Usage:");
            Console.WriteLine("  AC8MrpEditor.exe show [--save <path>]");
            Console.WriteLine("  AC8MrpEditor.exe verify [--save <path>]");
            Console.WriteLine("  AC8MrpEditor.exe set <amount> [--save <path>] [--dry-run] [--no-backup]");
            Console.WriteLine("  AC8MrpEditor.exe restore [--save <path>] [--backup <path>] [--yes]");
            Console.WriteLine("  AC8MrpEditor.exe backups [--save <path>]");
            Console.WriteLine();
            Console.WriteLine("Options:");
            Console.WriteLine("  --save <path>       Campaign.sav path. Defaults to the normal LocalAppData path.");
            Console.WriteLine("  --backup <path>     Backup path used by restore.");
            Console.WriteLine("  --backup-dir <dir>  Directory used when creating a backup.");
            Console.WriteLine("  --current-only      Set CurrentMRP only.");
            Console.WriteLine("  --total-only        Set TotalMRP only.");
            Console.WriteLine("  --dry-run           Calculate and print without writing.");
            Console.WriteLine("  --no-backup         Do not create a backup before set.");
            Console.WriteLine("  --yes               Skip the restore confirmation prompt.");
            Console.WriteLine("  --force             Bypass the running-game check. Use only if you know what you are doing.");
            Console.WriteLine();
            Console.WriteLine("Examples:");
            Console.WriteLine("  AC8MrpEditor.exe show");
            Console.WriteLine("  AC8MrpEditor.exe set 9999999");
            Console.WriteLine("  AC8MrpEditor.exe set 9999999 --dry-run");
            Console.WriteLine("  AC8MrpEditor.exe restore");
        }

        private static string Hex(uint value)
        {
            return "0x" + value.ToString("X8", CultureInfo.InvariantCulture);
        }

        private sealed class Options
        {
            public string Command;
            public string SavePath;
            public string BackupPath;
            public string BackupDirectory;
            public ulong? Amount;
            public bool Help;
            public bool DryRun;
            public bool NoBackup;
            public bool CurrentOnly;
            public bool TotalOnly;
            public bool Yes;
            public bool Force;

            public static Options Parse(string[] args)
            {
                var options = new Options();
                for (int i = 0; i < args.Length; i++)
                {
                    string arg = args[i];
                    switch (arg.ToLowerInvariant())
                    {
                        case "--help":
                        case "-h":
                        case "/?":
                            options.Help = true;
                            break;
                        case "--save":
                        case "-s":
                            options.SavePath = RequireValue(args, ref i, arg);
                            break;
                        case "--backup":
                            options.BackupPath = RequireValue(args, ref i, arg);
                            break;
                        case "--backup-dir":
                            options.BackupDirectory = RequireValue(args, ref i, arg);
                            break;
                        case "--dry-run":
                            options.DryRun = true;
                            break;
                        case "--no-backup":
                            options.NoBackup = true;
                            break;
                        case "--current-only":
                            options.CurrentOnly = true;
                            break;
                        case "--total-only":
                            options.TotalOnly = true;
                            break;
                        case "--yes":
                        case "-y":
                            options.Yes = true;
                            break;
                        case "--force":
                            options.Force = true;
                            break;
                        default:
                            if (options.Command == null)
                            {
                                options.Command = arg.ToLowerInvariant();
                            }
                            else if (options.Command == "set" && !options.Amount.HasValue)
                            {
                                ulong amount;
                                if (!ulong.TryParse(arg, NumberStyles.Integer, CultureInfo.InvariantCulture, out amount))
                                    throw new ArgumentException("Invalid MRP amount: " + arg);
                                options.Amount = amount;
                            }
                            else
                            {
                                throw new ArgumentException("Unexpected argument: " + arg);
                            }
                            break;
                    }
                }

                if (options.CurrentOnly && options.TotalOnly)
                    throw new ArgumentException("--current-only and --total-only cannot be used together.");

                return options;
            }

            private static string RequireValue(string[] args, ref int index, string option)
            {
                if (index + 1 >= args.Length || string.IsNullOrWhiteSpace(args[index + 1]))
                    throw new ArgumentException("Missing value for " + option);
                return args[++index];
            }
        }

        private sealed class TagInfo
        {
            public string Name;
            public string Type;
            public int TypeStart;
            public int TypeLength;
            public int TypeEnd { get { return TypeStart + TypeLength; } }
        }

        private sealed class SaveLayout
        {
            public string Path;
            public byte[] Bytes;
            public int PackedStart;
            public int PackedLength;
            public int ChecksumOffset;
            public int CurrentMrpOffset;
            public int TotalMrpOffset;
            public ulong CurrentMrp;
            public ulong TotalMrp;
            public uint StoredChecksum;

            public static SaveLayout Load(string path)
            {
                string fullPath = System.IO.Path.GetFullPath(path);
                if (!File.Exists(fullPath))
                    throw new FileNotFoundException("Save file not found: " + fullPath);

                byte[] bytes = File.ReadAllBytes(fullPath);
                if (bytes.Length < 16 || Encoding.ASCII.GetString(bytes, 0, 4) != "GVAS")
                    throw new InvalidDataException("Not an Unreal GVAS save file: " + fullPath);

                int packedNameStart = FindAscii(bytes, "PackedData", false);
                int checksumNameStart = FindAscii(bytes, "Checksum", true);
                if (packedNameStart < 0 || checksumNameStart < 0)
                    throw new InvalidDataException("Could not find PackedData or Checksum in the save.");

                TagInfo packed = ReadTag(bytes, packedNameStart);
                if (packed.Type != "ArrayProperty")
                    throw new InvalidDataException("PackedData is not an ArrayProperty.");

                int innerLengthOffset = packed.TypeEnd + 4;
                int innerLength = ReadInt32(bytes, innerLengthOffset);
                if (innerLength <= 0)
                    throw new InvalidDataException("Invalid PackedData inner type length.");

                int innerTypeStart = innerLengthOffset + 4;
                string innerType = ReadString(bytes, innerTypeStart, innerLength);
                if (innerType != "ByteProperty")
                    throw new InvalidDataException("PackedData inner type is not ByteProperty.");

                int innerTypeEnd = innerTypeStart + innerLength;
                int packedStart = innerTypeEnd + 13;
                int packedEnd = checksumNameStart - 4;
                int packedLength = packedEnd - packedStart;
                if (packedLength <= 0)
                    throw new InvalidDataException("Invalid PackedData range.");

                int count = ReadInt32(bytes, packedStart - 4);
                if (count != packedLength)
                    throw new InvalidDataException("PackedData length does not match its serialized count.");

                TagInfo checksum = ReadTag(bytes, checksumNameStart);
                if (checksum.Type != "UInt32Property")
                    throw new InvalidDataException("Checksum is not a UInt32Property.");

                int checksumOffset = checksum.TypeEnd + 9;
                int currentOffset = ReadUInt64Offset(bytes, "CurrentMRP");
                int totalOffset = ReadUInt64Offset(bytes, "TotalMRP");

                if (checksumOffset + 4 > bytes.Length || currentOffset + 8 > bytes.Length || totalOffset + 8 > bytes.Length)
                    throw new InvalidDataException("A parsed property offset is outside the file.");

                return new SaveLayout
                {
                    Path = fullPath,
                    Bytes = bytes,
                    PackedStart = packedStart,
                    PackedLength = packedLength,
                    ChecksumOffset = checksumOffset,
                    CurrentMrpOffset = currentOffset,
                    TotalMrpOffset = totalOffset,
                    CurrentMrp = BitConverter.ToUInt64(bytes, currentOffset),
                    TotalMrp = BitConverter.ToUInt64(bytes, totalOffset),
                    StoredChecksum = BitConverter.ToUInt32(bytes, checksumOffset)
                };
            }

            private static int ReadUInt64Offset(byte[] bytes, string name)
            {
                int nameStart = FindAscii(bytes, name, false);
                if (nameStart < 0)
                    throw new InvalidDataException("Could not find " + name + ".");
                TagInfo tag = ReadTag(bytes, nameStart);
                if (tag.Type != "UInt64Property")
                    throw new InvalidDataException(name + " is not a UInt64Property.");
                return tag.TypeEnd + 9;
            }

            private static TagInfo ReadTag(byte[] bytes, int nameStart)
            {
                if (nameStart < 4)
                    throw new InvalidDataException("Invalid property name offset.");

                int nameLength = ReadInt32(bytes, nameStart - 4);
                if (nameLength <= 0 || nameStart + nameLength > bytes.Length)
                    throw new InvalidDataException("Invalid property name length.");

                int typeLengthOffset = nameStart + nameLength;
                int typeLength = ReadInt32(bytes, typeLengthOffset);
                if (typeLength <= 0)
                    throw new InvalidDataException("Invalid property type length.");

                int typeStart = typeLengthOffset + 4;
                return new TagInfo
                {
                    Name = ReadString(bytes, nameStart, nameLength),
                    Type = ReadString(bytes, typeStart, typeLength),
                    TypeStart = typeStart,
                    TypeLength = typeLength
                };
            }

            private static string ReadString(byte[] bytes, int offset, int lengthIncludingNull)
            {
                if (lengthIncludingNull <= 0 || offset + lengthIncludingNull > bytes.Length)
                    throw new InvalidDataException("String field is outside the file.");
                if (bytes[offset + lengthIncludingNull - 1] != 0)
                    throw new InvalidDataException("String field is missing its null terminator.");
                return Encoding.UTF8.GetString(bytes, offset, lengthIncludingNull - 1);
            }

            private static int ReadInt32(byte[] bytes, int offset)
            {
                if (offset < 0 || offset + 4 > bytes.Length)
                    throw new InvalidDataException("Int32 field is outside the file.");
                return BitConverter.ToInt32(bytes, offset);
            }

            private static int FindAscii(byte[] bytes, string text, bool last)
            {
                byte[] needle = Encoding.ASCII.GetBytes(text);
                if (last)
                {
                    for (int i = bytes.Length - needle.Length; i >= 0; i--)
                    {
                        if (Matches(bytes, needle, i))
                            return i;
                    }
                }
                else
                {
                    for (int i = 0; i <= bytes.Length - needle.Length; i++)
                    {
                        if (Matches(bytes, needle, i))
                            return i;
                    }
                }
                return -1;
            }

            private static bool Matches(byte[] bytes, byte[] needle, int offset)
            {
                for (int i = 0; i < needle.Length; i++)
                {
                    if (bytes[offset + i] != needle[i])
                        return false;
                }
                return true;
            }
        }
    }
}


