-- Migration: Add nome field to agendamentos for schedule naming
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS nome TEXT;
