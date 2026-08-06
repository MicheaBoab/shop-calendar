# Pending / 暂定占位员工逻辑说明

这份项目已经把 pending / 暂定占位员工的规则收敛到一套统一、可维护的实现上。后续如果要调整“谁是占位员工”或者“删除员工后如何处理预约”，都应优先从这一套入口开始看。

## 1. 统一来源

- 共享规则定义在 [../shared/pending-assignment.ts](../shared/pending-assignment.ts)。
- 默认占位员工用户名为 `pending_assignment`，默认可以通过环境变量 `PENDING_EMPLOYEE_USERNAME` 或前端运行时的 `PENDING_EMPLOYEE_USERNAME` 覆盖。
- 后端和前端都依赖这份共享逻辑判断“当前员工是否是占位员工”，避免各自维护一套不同判定规则。

## 2. 当前业务行为

- 创建或修改预约时，如果目标员工是占位员工，则跳过重叠冲突检查，避免占位员工被当成真实员工阻塞时间段。
- 当真实员工被删除时，只有状态为 `SCHEDULED` 且开始时间在未来的预约会被回退到占位员工。
- 历史预约保持不变，不会因为员工删除而被回写或改成占位员工。
- 预约回退时会保留原有员工显示名和颜色信息作为快照，便于后续展示和审计。

## 3. 维护方式

如果后续需要扩展这套逻辑，建议按下面的入口修改：

- 识别“谁是占位员工”：修改 [../shared/pending-assignment.ts](../shared/pending-assignment.ts)。
- 调整“员工删除后如何回退未来预约”：修改 [../backend/src/users/users.service.ts](../backend/src/users/users.service.ts) 中的 `removeUser` 逻辑。
- 调整“创建/修改预约时是否跳过冲突检查”：修改 [../backend/src/appointments/appointments.service.ts](../backend/src/appointments/appointments.service.ts)。
- 调整前端展示与文案：查看 [../frontend/src/App.tsx](../frontend/src/App.tsx) 和 [../frontend/src/i18n/messages.ts](../frontend/src/i18n/messages.ts)。

## 4. 设计目标

这套实现的重点是把“身份识别”和“业务规则”拆开：

- 身份识别由共享模块负责；
- 业务动作由后端服务负责；
- 展示与文案由前端负责。

这样后续新增状态、修改回退条件或换成另一种占位策略时，修改点会更集中，更容易维护。
