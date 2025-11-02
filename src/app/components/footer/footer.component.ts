import { Component, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
})
export class FooterComponent {
  private router = inject(Router);

  /* Footer is different in /home (black/60) */
  isHomePage = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url === '/' || this.router.url === '')
    ),
    { initialValue: this.router.url === '/' || this.router.url === '' }
  );
}
