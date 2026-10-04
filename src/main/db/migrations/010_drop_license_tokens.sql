-- Migration 010: licensing was removed (Flowstate is free and open source).
-- Drop any license tokens older builds stored in the settings table.
DELETE FROM settings WHERE key LIKE 'license.%';
