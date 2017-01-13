{%- extends 'full.tpl' -%}

{% block codecell %}

{%- if cell['metadata'].get('backgroundColor',{}) is not none -%}
	<div class="cell border-box-sizing code_cell rendered" style="background-color:{{cell['metadata'].get('backgroundColor',{})}}">

{%- endif -%}
	{{ super() }}

</div>
{%- endblock codecell %}