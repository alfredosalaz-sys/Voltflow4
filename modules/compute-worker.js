(() => {
  'use strict';

  function sortLeads(list, sort) {
    list.sort((a, b) => {
      if (sort === 'score') return (b.score || 0) - (a.score || 0);
      if (sort === 'date') return new Date(b.date || 0) - new Date(a.date || 0);
      if (sort === 'company') return String(a.company || '').localeCompare(String(b.company || ''));
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sort === 'next_contact') {
        if (!a.next_contact && !b.next_contact) return 0;
        if (!a.next_contact) return 1;
        if (!b.next_contact) return -1;
        return new Date(a.next_contact) - new Date(b.next_contact);
      }
      if (sort === 'days_status') {
        const now = Date.now();
        const daysA = a.status_date ? Math.floor((now - new Date(a.status_date)) / 86400000) : 0;
        const daysB = b.status_date ? Math.floor((now - new Date(b.status_date)) / 86400000) : 0;
        return daysB - daysA;
      }
      return 0;
    });
    return list;
  }

  function matchesCoverageScope(lead, scope) {
    if (!scope || !lead) return true;
    const wantedLocation = String(scope.location || '').trim().toLowerCase();
    const wantedSector = String(scope.sector || '').trim();
    const wantedMission = String(scope.missionId || '').trim();
    const leadLocation = String(lead.coverageLocation || lead.coverageMission?.location || '').trim().toLowerCase();
    const leadSector = String(lead.coverageSector || lead.coverageMission?.sector || lead.segment || '').trim();
    const leadMission = String(lead.coverageMissionId || lead.coverageMission?.id || '').trim();
    if (wantedMission && leadMission === wantedMission) return true;
    if (wantedLocation && leadLocation !== wantedLocation) return false;
    if (wantedSector && wantedSector !== leadSector && wantedSector !== lead.segment) return false;
    return true;
  }

  function computeFilteredLeadIds(payload) {
    const leads = Array.isArray(payload.leads) ? payload.leads : [];
    const filters = payload.filters || {};
    const search = String(filters.search || '').toLowerCase();
    const seg = String(filters.seg || '');
    const status = String(filters.status || '');
    const source = String(filters.source || '');
    const sort = String(filters.sort || 'score');
    const scoreMin = Number(filters.scoreMin || 0) || 0;
    const dateRange = String(filters.dateRange || '');
    const nextCon = String(filters.nextCon || '');
    const coverageScope = filters.coverageScope || null;
    const preset = String(filters.preset || '');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(today.getMonth() - 3);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const totalActive = leads.filter(l => !l.archived).length;
    const filtered = leads.filter(l => {
      if (!l || l.archived) return false;
      if (!matchesCoverageScope(l, coverageScope)) return false;
      if (preset === 'no_email' && l.email) return false;
      if (search) {
        const haystack = [
          l.name, l.company, l.email, l.phone, l.segment, l.signal, l.notes, l.address, l.web, l.description,
          l.coverageLocation, l.coverageSector, l.coverageMissionId, l.coverageMissionLabel,
          l.coverageMission?.label, l.coverageMission?.location, l.coverageMission?.sector,
          ...(Array.isArray(l.tags) ? l.tags : []),
          ...(Array.isArray(l.signals) ? l.signals : [])
        ].join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (seg && l.segment !== seg) return false;
      if (status && l.status !== status) return false;
      if (source && (l.source || 'manual') !== source) return false;
      if (scoreMin && Number(l.score || 0) < scoreMin) return false;
      if (dateRange && l.date) {
        const d = new Date(l.date);
        d.setHours(0, 0, 0, 0);
        if (dateRange === 'today' && d.getTime() !== today.getTime()) return false;
        if (dateRange === 'week' && d < weekStart) return false;
        if (dateRange === 'month' && d < monthStart) return false;
        if (dateRange === '3months' && d < threeMonthsAgo) return false;
      }
      if (nextCon) {
        if (nextCon === 'none' && l.next_contact) return false;
        if (nextCon === 'overdue') {
          if (!l.next_contact) return false;
          if (new Date(l.next_contact) >= today) return false;
        }
        if (nextCon === 'today') {
          if (!l.next_contact) return false;
          const nc = new Date(l.next_contact);
          nc.setHours(0, 0, 0, 0);
          if (nc.getTime() !== today.getTime()) return false;
        }
        if (nextCon === 'week') {
          if (!l.next_contact) return false;
          const nc = new Date(l.next_contact);
          nc.setHours(0, 0, 0, 0);
          if (nc < today || nc >= weekEnd) return false;
        }
      }
      return true;
    });

    sortLeads(filtered, sort);
    const activeFilters = [search, seg, status, source, scoreMin, dateRange, nextCon, coverageScope ? 'coverage' : '', preset].filter(Boolean).length;
    return {
      ids: filtered.map(l => l.id),
      totalActive,
      activeFilters
    };
  }

  self.onmessage = event => {
    const data = event.data || {};
    if (data.type === 'filterLeads') {
      const result = computeFilteredLeadIds(data.payload || {});
      self.postMessage({
        type: 'filterLeadsResult',
        requestId: data.requestId,
        result
      });
    }
  };
})();
