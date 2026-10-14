/**
 * Component Marketplace routes -- read is available to every internal role
 * (same as every other read surface in this app); publishing is restricted
 * to admin/analyst (the same roles that can create anything else);
 * deleting is restricted further, to the component's own publisher or an
 * admin, so one analyst can't remove another's contribution to the shared
 * library.
 */
import type { Express } from "express";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { listComponents, getComponent, publishComponent, deleteComponent } from "./uideEngine/componentLibraryStore";

const COMPONENT_AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const COMPONENT_READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

export function registerComponentLibraryRoutes(app: Express): void {
  app.get("/api/component-library", requireRole(...COMPONENT_READ_ROLES), (_req, res) => {
    res.json(listComponents());
  });

  app.post("/api/component-library", requireRole(...COMPONENT_AUTHOR_ROLES), async (req, res) => {
    const { name, description, category, cells } = req.body as {
      name?: string; description?: string; category?: string; cells?: Record<string, string>;
    };
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    if (!cells || typeof cells !== "object" || Array.isArray(cells) || Object.keys(cells).length === 0) {
      res.status(400).json({ error: "cells must be a non-empty fragment -- select a range with content before publishing." });
      return;
    }
    const component = publishComponent({ name: name.trim(), description: description?.trim() || "", category: category?.trim() || "Uncategorized", cells }, req.user!.id);
    await recordAuditEvent(req.user!.id, "component_published", { componentId: component.id, name: component.name, ...auditActor(req.user!) });
    res.json(component);
  });

  app.delete("/api/component-library/:id", requireRole(...COMPONENT_AUTHOR_ROLES), async (req, res) => {
    const component = getComponent(String(req.params.id));
    if (!component) {
      res.status(404).json({ error: "Component not found." });
      return;
    }
    if (component.publishedByUserId !== req.user!.id && req.user!.role !== "internal_admin") {
      res.status(403).json({ error: "Only the publisher or an admin can remove this component." });
      return;
    }
    const remaining = deleteComponent(String(req.params.id));
    await recordAuditEvent(req.user!.id, "component_deleted", { componentId: req.params.id, ...auditActor(req.user!) });
    res.json(remaining);
  });
}
