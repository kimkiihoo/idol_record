(function (root) {
  'use strict';
  function commit(ctx, next) {
    ctx.persist(next);
    ctx.state = ctx.C.validateState(next);
    ctx.rerender();
  }
  function pricing(ctx) {
    const C = ctx.C,
      types = C.benefitTypes(ctx.state),
      presets = ctx.state.config.price_presets || [];
    ctx.modal(
      '价格与自定义特典',
      '<div class="actions"><button id="add-price" class="primary">新增价格预设</button><button id="add-benefit-type" class="outline">新增特典类型</button></div><p class="subtle">单人录入时优先采用成员预设，其次团体预设，再采用通用预设。实际成交金额保存在每条记录中。</p><h3>常用价格</h3>' +
        presets
          .map(
            (preset) =>
              '<div class="card"><div class="row"><strong>' +
              ctx.esc(preset.name) +
              '</strong><strong>' +
              ctx.money(C.cents(preset.price)) +
              '</strong></div><p>' +
              ctx.esc(
                (preset.scope === 'all'
                  ? '通用'
                  : preset.scope === 'member'
                    ? C.memberLabel(
                        C.resolveMember(ctx.state, preset.target),
                        ctx.state,
                      )
                    : preset.target) +
                  ' · ' +
                  (types[preset.format] || preset.format) +
                  (preset.size ? ' · ' + preset.size + '寸' : '') +
                  (preset.signature
                    ? ' · ' + (preset.signature === 'signed' ? '有签' : '无签')
                    : '') +
                  (preset.themed ? ' · 主题' : ''),
              ) +
              '</p><div class="actions"><button data-edit-price="' +
              ctx.esc(preset.id) +
              '">编辑</button><button data-delete-price="' +
              ctx.esc(preset.id) +
              '" class="danger">删除</button></div></div>',
          )
          .join('') +
        (presets.length ? '' : ctx.empty('尚未设置价格预设')) +
        '<h3>自定义特典</h3>' +
        (ctx.state.config.benefit_types || [])
          .map(
            (type) =>
              '<div class="row"><span>' +
              ctx.esc(type.label) +
              (type.counts_as_photo ? ' · 计入拍切' : ' · 计入全部特典') +
              '</span><button data-edit-benefit="' +
              ctx.esc(type.id) +
              '">编辑</button><button data-delete-benefit="' +
              ctx.esc(type.id) +
              '" class="text danger">删除</button></div>',
          )
          .join(''),
    );
    ctx.on('#add-price', 'click', () => editPrice(ctx));
    ctx.on('#add-benefit-type', 'click', () => editType(ctx));
    ctx.allOn('[data-edit-price]', 'click', (button) =>
      editPrice(ctx, button.dataset.editPrice),
    );
    ctx.allOn('[data-delete-price]', 'click', (button) => {
      (ctx.askConfirm || ((o, fn) => { if (confirm(o.message || o)) fn(); }))(
        { title: '删除价格预设', message: '确认删除这个价格预设？', okText: '确认删除', danger: true },
        () => {
          const next = C.clone(ctx.state);
          next.config.price_presets = presets.filter(
            (preset) => preset.id !== button.dataset.deletePrice,
          );
          commit(ctx, next);
          pricing(ctx);
        },
      );
    });
    ctx.allOn('[data-edit-benefit]', 'click', (button) =>
      editType(ctx, button.dataset.editBenefit),
    );
    ctx.allOn('[data-delete-benefit]', 'click', (button) => {
      const key = 'custom:' + button.dataset.deleteBenefit;
      if (
        ctx.state.records.some((event) =>
          event.interactions.some((item) => item.benefit_format === key),
        ) ||
        presets.some((preset) => preset.format === key)
      ) {
        ctx.notify('这个类型已有记录或价格预设，可编辑名称与分类');
        return;
      }
      const next = C.clone(ctx.state);
      next.config.benefit_types = next.config.benefit_types.filter(
        (type) => type.id !== button.dataset.deleteBenefit,
      );
      commit(ctx, next);
      pricing(ctx);
    });
  }
  function editPrice(ctx, id) {
    const C = ctx.C,
      old = (ctx.state.config.price_presets || []).find(
        (preset) => preset.id === id,
      ) || {
        id: ctx.uid(),
        name: '',
        scope: 'group',
        target: '',
        format: 'cheki',
        price: 0,
      };
    ctx.modal(
      id ? '编辑价格预设' : '新增价格预设',
      ctx.field(
        '预设名称',
        'preset-name',
        old.name,
        'text',
        'maxlength="100"',
      ) +
        ctx.select(
          '适用范围',
          'preset-scope',
          { group: '指定团体', member: '指定成员', all: '通用' },
          old.scope,
        ) +
        '<div id="preset-target-field"></div>' +
        ctx.select(
          '特典形式',
          'preset-format',
          C.benefitTypes(ctx.state),
          old.format,
        ) +
        '<div class="form-grid">' +
        ctx.select(
          '尺寸条件',
          'preset-size',
          { '': '任意尺寸', 3: '3寸', 5: '5寸', other: '其它尺寸' },
          old.size || '',
        ) +
        ctx.select(
          '签名条件',
          'preset-signature',
          { '': '任意', signed: '有签', unsigned: '无签' },
          old.signature || '',
        ) +
        '</div>' +
        ctx.field(
          '单价（元）',
          'preset-price',
          C.money(C.cents(old.price)),
          'text',
          'inputmode="decimal"',
        ) +
        '<div id="form-error" class="error"></div><button id="save-price" class="primary" style="width:100%">保存价格预设</button>',
      true,
    );
    function targets() {
      const scope = ctx.read('preset-scope');
      document.querySelector('#preset-target-field').innerHTML =
        scope === 'all'
          ? ''
          : scope === 'member'
            ? ctx.select(
                '成员',
                'preset-target',
                Object.fromEntries(
                  C.memberCatalog(ctx.state).map((profile) => [
                    profile.id,
                    C.memberLabel(profile, ctx.state),
                  ]),
                ),
                old.target,
              )
            : ctx.field(
                '团体',
                'preset-target',
                old.scope === 'group' ? old.target : '',
                'text',
                'autocomplete="off"',
              ) + ctx.historyPicker('preset-groups');
      if (scope === 'group')
        ctx.bindHistory('preset-groups', 'preset-target', () =>
          C.groupCatalog(ctx.state),
        );
    }
    targets();
    ctx.on('#preset-scope', 'change', targets);
    ctx.on('#save-price', 'click', () => {
      const next = C.clone(ctx.state),
        scope = ctx.read('preset-scope'),
        name = ctx.read('preset-name');
      if (!name) throw new Error('请填写预设名称');
      const preset = {
        id: old.id,
        name,
        scope,
        target: scope === 'all' ? '' : ctx.read('preset-target'),
        format: ctx.read('preset-format'),
        size: ctx.read('preset-size'),
        signature: ctx.read('preset-signature'),
        themed: ctx.read('preset-format') === 'theme' || Boolean(old.themed),
        price: C.amount(C.cents(ctx.read('preset-price'))),
      };
      next.config.price_presets = (next.config.price_presets || [])
        .filter((row) => row.id !== old.id)
        .concat(preset);
      commit(ctx, next);
      pricing(ctx);
      ctx.notify('价格预设已保存');
    });
  }
  function editType(ctx, id) {
    const old = (ctx.state.config.benefit_types || []).find(
      (type) => type.id === id,
    ) || { id: ctx.uid(), label: '', counts_as_photo: false };
    ctx.modal(
      id ? '编辑特典类型' : '新增特典类型',
      ctx.field(
        '特典名称',
        'benefit-name',
        old.label,
        'text',
        'maxlength="100"',
      ) +
        ctx.select(
          '统计分类',
          'benefit-photo',
          { no: '全部特典', yes: '全部特典，并计入拍切记录' },
          old.counts_as_photo ? 'yes' : 'no',
        ) +
        '<div id="form-error" class="error"></div><button id="save-benefit" class="primary" style="width:100%">保存特典类型</button>',
      true,
    );
    ctx.on('#save-benefit', 'click', () => {
      const label = ctx.read('benefit-name');
      if (!label) throw new Error('请填写特典名称');
      const next = ctx.C.clone(ctx.state);
      next.config.benefit_types = (next.config.benefit_types || [])
        .filter((type) => type.id !== old.id)
        .concat({
          id: old.id,
          label,
          counts_as_photo: ctx.read('benefit-photo') === 'yes',
        });
      commit(ctx, next);
      pricing(ctx);
    });
  }
  function preferences(ctx) {
    ctx.modal(
      '显示设置',
      ctx.select(
        '外观',
        'pref-theme',
        { system: '跟随系统', light: '浅色', dark: '深色' },
        ctx.state.config.theme || 'system',
      ) +
        ctx.select(
          '字号',
          'pref-font',
          { 1: '标准', 1.15: '较大', 1.3: '大字' },
          String(ctx.state.config.font_scale || 1),
        ) +
        '<button id="save-preferences" class="primary" style="width:100%">保存设置</button>',
    );
    ctx.on('#save-preferences', 'click', () => {
      const next = ctx.C.clone(ctx.state);
      next.config.theme = ctx.read('pref-theme');
      next.config.font_scale = Number(ctx.read('pref-font'));
      next.config.backup_reminder_days = 0;
      commit(ctx, next);
      ctx.closeModal(true);
      ctx.notify('设置已保存');
    });
  }
  function calendar(ctx) {
    let month = ctx.anchor.slice(0, 7),
      selected = '';
    function paint() {
      const summaries = ctx.C.calendarSummary(ctx.state, month),
        byDate = new Map(summaries.map((day) => [day.date, day])),
        first = new Date(month + '-01T12:00:00'),
        days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(),
        offset = (first.getDay() + 6) % 7;
      const chosen = byDate.get(selected),
        events = chosen
          ? Array.from(
              new Map(
                [
                  ...chosen.events,
                  ...chosen.interactions.map((row) => row.event),
                ].map((event) => [event.id, event]),
              ).values(),
            )
          : [];
      ctx.modal(
        '偶活日历',
        ctx.field('月份', 'calendar-month', month, 'month') +
          '<p class="subtle">活动与支出按活动日期，拍切按拍摄日期。金额为 0 的真实活动也会标记。</p><div class="calendar-grid">' +
          ['一', '二', '三', '四', '五', '六', '日']
            .map((day) => '<small>' + day + '</small>')
            .join('') +
          Array.from({ length: offset }, () => '<span></span>').join('') +
          Array.from({ length: days }, (_, index) => {
            const date = month + '-' + String(index + 1).padStart(2, '0'),
              day = byDate.get(date);
            return (
              '<button data-calendar-date="' +
              date +
              '" class="' +
              (date === selected ? 'active ' : '') +
              (day ? 'has-record' : '') +
              '" aria-label="' +
              date +
              (day ? '，有记录' : '，无记录') +
              '">' +
              (index + 1) +
              (day
                ? '<small>' +
                  day.events.length +
                  '场 / ' +
                  day.photos +
                  '张</small>'
                : '') +
              '</button>'
            );
          }).join('') +
          '</div><div id="calendar-day">' +
          (selected
            ? '<h3>' +
              ctx.esc(selected) +
              '</h3>' +
              (chosen
                ? ctx.detailLine(
                    '活动 / 拍切',
                    chosen.events.length + ' 场 / ' + chosen.photos + ' 张',
                  ) +
                  ctx.detailLine('活动日支出', ctx.money(chosen.total)) +
                  events
                    .map(
                      (event) =>
                        '<button class="interaction-card" data-calendar-event="' +
                        ctx.esc(event.id) +
                        '">' +
                        ctx.esc(event.date + ' · ' + event.event_name) +
                        '</button>',
                    )
                    .join('')
                : ctx.empty('当天暂无记录'))
            : '<p class="subtle">点选日期查看当天摘要与关联活动。</p>') +
          '</div>',
      );
      ctx.on('#calendar-month', 'change', () => {
        const value = ctx.read('calendar-month');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value.startsWith('0000'))
          throw new Error('请选择有效月份');
        month = value;
        selected = '';
        paint();
      });
      ctx.allOn('[data-calendar-date]', 'click', (button) => {
        selected = button.dataset.calendarDate;
        paint();
      });
      ctx.allOn('[data-calendar-event]', 'click', (button) =>
        ctx.onEvent(button.dataset.calendarEvent),
      );
    }
    paint();
  }
  function annual(ctx) {
    let year = ctx.anchor.slice(0, 4);
    function paint() {
      const review = ctx.C.annualSummary(ctx.state, year),
        stats = review.stats;
      ctx.modal(
        '年度回顾',
        ctx.field('年份', 'review-year', year, 'number', 'min="1" max="9999"') +
          '<div class="card">' +
          ctx.detailLine('年度总支出', ctx.money(stats.total)) +
          ctx.detailLine(
            '演出 / 活动日',
            (stats.eventTypes.performance || 0) +
              ' 场 / ' +
              review.days +
              ' 天',
          ) +
          ctx.detailLine('真实城市', review.cities + ' 个') +
          ctx.detailLine(
            '门票 / 免费票',
            review.tickets.quantity + ' 张 / ' + review.tickets.free + ' 张',
          ) +
          ctx.detailLine('手机合影', (stats.phoneCount||0)+' 张')+ctx.detailLine('首次互动成员', review.newMembers.length + ' 位') +
          (review.months.length
            ? ctx.detailLine(
                '支出最高月份',
                review.months[0].name +
                  ' · ' +
                  ctx.money(review.months[0].cost),
              )
            : '') +
          '</div><h3>年度成员互动</h3>' +
          review.members
            .map(
              (member) =>
                '<button class="profile-row" data-review-member="' +
                ctx.esc(member.id) +
                '">' +
                (root.IdolPeople
                  ? root.IdolPeople.avatar(
                      ctx,
                      ctx.C.resolveMember(ctx.state, member.id),
                    )
                  : '') +
                '<span>' +
                ctx.esc(
                  ctx.C.memberLabel(
                    ctx.C.resolveMember(ctx.state, member.id),
                    ctx.state,
                  ),
                ) +
                '</span><span>' +
                member.count +
                ' 张' +
                (member.phone_count
                  ? ' · 手机 ' + member.phone_count + '张'
                  : '') +
                ' · ' +
                ctx.money(member.cost) +
                '</span></button>',
            )
            .join('') +
          (review.members.length ? '' : ctx.empty('这一年暂无成员互动')) +
          '<details><summary>首次互动成员</summary>' +
          review.newMembers
            .map(
              (profile) =>
                '<p>' + ctx.esc(ctx.C.memberLabel(profile, ctx.state)) + '</p>',
            )
            .join('') +
          '</details><p class="subtle">消费与足迹按活动日期，成员按拍摄日期。首次互动依据现有全部历史记录计算。</p>',
      );
      ctx.on('#review-year', 'change', () => {
        year = ctx.read('review-year');
        paint();
      });
      ctx.allOn('[data-review-member]', 'click', (button) =>
        root.IdolPeople.showMember(
          Object.assign({}, ctx, {
            range: ctx.C.periodRange('year', year + '-01-01'),
          }),
          button.dataset.reviewMember,
        ),
      );
    }
    paint();
  }
  function budgetManager(ctx) {
    const now = new Date();
    const fallbackMonth =
      String(now.getFullYear()).padStart(4, '0') +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0');
    let month = (ctx.anchor && /^\d{4}-\d{2}/.test(ctx.anchor) ? ctx.anchor.slice(0, 7) : fallbackMonth);
    function validMonth(value) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value.startsWith('0000')) {
        throw new Error('请选择有效的月份（YYYY-MM）');
      }
      return value;
    }
    function paint() {
      const overrides = ctx.state.config.monthly_budgets || {};
      const defaultBudget = ctx.state.config.monthly_budget || 0;
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, month);
      const currentValue = hasOverride ? overrides[month] : defaultBudget;
      const entries = Object.entries(overrides).sort((a, b) => b[0].localeCompare(a[0]));
      ctx.modal(
        '预算管理',
        '<div class="card">' +
          '<h3>指定月份预算</h3>' +
          ctx.field('月份', 'budget-month', month, 'month') +
          ctx.field('该月预算金额（元）；0 表示不设预算', 'budget-month-amount', currentValue, 'text', 'inputmode="decimal"') +
          '<p class="subtle">' +
          (hasOverride ? '本月已单独设置预算，将优先于默认月预算。' : '本月暂未单独设置，当前沿用默认月预算。') +
          '</p>' +
          '<div class="actions"><button id="save-month-budget" class="primary">保存该月预算</button>' +
          (hasOverride ? '<button id="clear-month-budget" class="outline">恢复默认</button>' : '') +
          '</div></div>' +
          '<div class="section-title"><h3>默认每月预算</h3></div>' +
          '<div class="card">' +
          ctx.field('默认金额（元）；未单独设置的月份使用', 'budget-default-amount', defaultBudget, 'text', 'inputmode="decimal"') +
          '<button id="save-default-budget" class="outline" style="width:100%">保存默认月预算</button>' +
          '</div>' +
          (entries.length
            ? '<div class="section-title row"><h3>已单独设置的月份</h3><small>' + entries.length + ' 个</small></div>' +
              entries
                .map(
                  ([key, value]) =>
                    '<button class="profile-row" data-budget-month="' +
                    ctx.esc(key) +
                    '"><span><strong>' +
                    ctx.esc(key) +
                    '</strong><small>单独预算 ' +
                    ctx.esc(ctx.money(ctx.C.cents(value))) +
                    '</small></span><span>修改 ›</span></button>',
                )
                .join('')
            : '') +
          '<div id="form-error" class="error"></div>' +
          '<p class="subtle">预算按自然月使用，总览界面自动读取当月对应预算。</p>',
      );
      ctx.on('#budget-month', 'change', () => {
        month = validMonth(ctx.read('budget-month'));
        paint();
      });
      ctx.on('#save-month-budget', 'click', () => {
        month = validMonth(ctx.read('budget-month'));
        const next = ctx.C.clone(ctx.state);
        next.config.monthly_budgets = Object.assign({}, next.config.monthly_budgets || {}, {
          [month]: ctx.C.amount(ctx.C.cents(ctx.read('budget-month-amount'))),
        });
        commit(ctx, next);
        ctx.notify('已保存 ' + month + ' 预算');
        paint();
      });
      ctx.on('#clear-month-budget', 'click', () => {
        const next = ctx.C.clone(ctx.state);
        if (next.config.monthly_budgets) {
          delete next.config.monthly_budgets[month];
          if (!Object.keys(next.config.monthly_budgets).length) delete next.config.monthly_budgets;
        }
        commit(ctx, next);
        ctx.notify('已恢复 ' + month + ' 使用默认预算');
        paint();
      });
      ctx.on('#save-default-budget', 'click', () => {
        const next = ctx.C.clone(ctx.state);
        next.config.monthly_budget = ctx.C.amount(ctx.C.cents(ctx.read('budget-default-amount')));
        commit(ctx, next);
        ctx.notify('默认月预算已保存');
        paint();
      });
      ctx.allOn('[data-budget-month]', 'click', (button) => {
        month = button.dataset.budgetMonth;
        paint();
      });
    }
    paint();
  }
  root.IdolExtras = { pricing, preferences, calendar, annual, budgetManager };
})(typeof globalThis !== 'undefined' ? globalThis : this);
