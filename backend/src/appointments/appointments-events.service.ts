import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface AppointmentsChangedEvent {
  type: 'appointments.changed';
  timestamp: string;
  actorId?: string;
}

@Injectable()
export class AppointmentsEventsService {
  private readonly appointmentsChangedSubject = new Subject<AppointmentsChangedEvent>();

  publishAppointmentsChanged(actorId?: string) {
    this.appointmentsChangedSubject.next({
      type: 'appointments.changed',
      timestamp: new Date().toISOString(),
      actorId,
    });
  }

  watchAppointmentsChanged(): Observable<AppointmentsChangedEvent> {
    return this.appointmentsChangedSubject.asObservable();
  }
}
