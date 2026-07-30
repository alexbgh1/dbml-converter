import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { ArrowRightIconComponent } from '../../shared/components/icons/arrows/arrow-right-icon.component';
import { ErDiagramIconComponent } from '../../shared/components/icons/view-mode/er-diagram-icon.component';
import { APP_ROUTES } from '../../shared/constants/app-routes.constants';
import { CodeLine } from '../../components/dbml-converter/interfaces/editor.interface';
import { PrismService } from '../../services/prism/prism.service';

const HOME_DBML_EXAMPLE = [
  'Table users {',
  '  id int [pk, increment]',
  '  username varchar [unique]',
  '  email varchar [unique, not null]',
  '}',
  '',
  'Table posts {',
  '  id int [pk, increment]',
  '  user_id int [ref: > users.id]',
  '}',
].join('\n');

@Component({
  selector: 'app-home',
  imports: [RouterLink, ArrowRightIconComponent, ErDiagramIconComponent],
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'block' },
})
export class HomeComponent {
  private prismService = inject(PrismService);

  readonly APP_ROUTES = APP_ROUTES;
  readonly codeLines = computed<CodeLine[]>(() =>
    this.prismService
      .highlight(HOME_DBML_EXAMPLE)
      .split('\n')
      .map((content, index) => ({
        number: index + 1,
        content: content || '&nbsp;',
      })),
  );
}
