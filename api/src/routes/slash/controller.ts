import { Catalog, Complete, Resolve } from '../../@types/slash';
import * as hermes from '../../services/hermes';

function normalizeQuery(value?: string): string {
  return typeof value === 'string' ? value : '';
}

function normalizeLimit(value?: string, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export const catalog: Catalog = async (req, res, next) => {
  try {
    const query = normalizeQuery(req.query.q || req.query.query);
    const limit = normalizeLimit(req.query.limit, 200);
    const items = hermes.buildSlashCatalog({ profile: req.query.profile ?? null });
    const visibleItems = query ? hermes.filterSlashCatalog(items, query, limit) : items.slice(0, limit);
    return res.json({ items: visibleItems, total: visibleItems.length, query });
  } catch (error) {
    return next(error);
  }
};

export const complete: Complete = async (req, res, next) => {
  try {
    const query = normalizeQuery(req.query.q || req.query.query);
    const limit = normalizeLimit(req.query.limit);
    const items = hermes.completeSlashCatalog(query, { profile: req.query.profile ?? null }, limit);
    return res.json({ items, total: items.length, query });
  } catch (error) {
    return next(error);
  }
};

export const resolve: Resolve = async (req, res, next) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const profile = typeof req.body?.profile === 'string' ? req.body.profile : null;
    return res.json(hermes.resolveSlashCommand(text, { profile }));
  } catch (error) {
    return next(error);
  }
};
